# 助手配置「生效层」实现说明

本文档说明网关中 **助手配置（Persona / Tools / Constraints / CostControl）在保存之后如何参与运行时决策**，对应 [backend-assistant-config-todo.md](./backend-assistant-config-todo.md) 第四节「配置生效」的落地与相关代码、契约变更。

---

## 一、本次实现了什么

### 1. 策略模块（新建）

- **文件**：`backend/gateway/src/assistants/assistant-config-policy.ts`
- **内容**：
  - **拒绝类约束（deny rules）**：对用户可见的 `prompt` / `message` 做校验。内置对契约示例标签 `generate-malware`、`expose-credentials` 的规则匹配（多正则组合）；其余规则按 slug 分段做启发式子串匹配。
  - **月度 Token 上限**：若配置了 `monthlyTokenLimitM` 且 `tokenUsedThisMonthM ≥` 上限，则拒绝继续派发/聊天。
  - **最低接单价格**：若请求里带了数值型 `taskPrice` 且助手配置了 `minAcceptPrice`，则 `taskPrice < minAcceptPrice` 时拒绝。
  - **Persona 前缀**：把 `role`、`description`、`coreResponsibilities`、`skillTags` 格式化为一段 `[AIFutureCity assistant config]` 前缀，拼在实际发给 OpenClaw 的文本之前。
  - **用量粗估**：`estimateTokensM(text)` ≈ `字符数 / 4 / 10⁶`，用于成功调用后的用量累加（非精确计费，仅网关侧粗粒度账本）。

### 2. WebSocket RPC：`tasks.dispatch` / `openclaw.tasks.dispatch` / `openclaw.chat.send`

- **文件**：`backend/gateway/src/methods/tasks.ts`、`backend/gateway/src/methods/openclaw.ts`
- **行为**：
  - 在真正调用 OpenClaw 或返回 local-plan 之前，按 **有效助手 ID** 加载 `AssistantConfigStore` 中的配置并执行约束与成本校验。
  - **有效 ID**：显式 `assistantId` 若为空则使用 `OpenClawGatewayService.resolveDispatchAgentId`（新增），回退到环境里的 `defaultAgentId`。
  - `openclaw.chat.send`：可从 `sessionKey` 的 `training-<id>` 形式解析助手 ID，也可显式传 `assistantId`；有 Persona 时前缀到 `message`。
  - 派发/聊天 **成功结束后** 按粗估增量更新 `tokenUsedThisMonthM` 并触发与 HTTP 相同的 **持久化回调**（默认 SQLite、可选仅 JSON、或 PostgreSQL，取决于网关启动配置）。持久化分层说明见 [backend-assistants-sqlite-persistence.md](./backend-assistants-sqlite-persistence.md)。
- **返回差异**：
  - `tasks.dispatch`：策略拒绝时返回 `{ accepted: false, provider: "policy", code, error }`（如 `CONSTRAINT_BLOCKED`、`COST_LIMIT`、`PRICE_TOO_LOW`），不抛异常。
  - `openclaw.tasks.dispatch` / `openclaw.chat.send`：策略拒绝时 **抛错**，由 WS 层统一变成 `ok: false`（`message` 中带 `CONSTRAINT_BLOCKED:` 等前缀），与原有 RPC 错误形态一致。

### 3. 路由与启动接线

- **文件**：`backend/gateway/src/server/method-router.ts`、`backend/gateway/src/server/ws-server.ts`、`backend/gateway/src/index.ts`
- **行为**：`createMethodRouter` 增加依赖 `assistantConfig` 与可选的 `persistAssistantsData`；WebSocket 侧与 HTTP 共用同一套配置存储与持久化，避免「HTTP 改了配置、WS 仍用旧内存」的不一致。

### 4. HTTP 训练相关

- **文件**：`backend/gateway/src/server/http-server.ts`
- **行为**：
  - **`POST .../training/chat/send`**：发送前做约束与月度上限校验；将 Persona 前缀写入实际发送内容；成功后累加粗估用量并持久化。
  - **`POST .../training/chat/evaluate`**：对 `testPrompt` 与最终用户侧文案做约束校验；通过 OpenClaw 拉取 `testPrompt` 回复时同样带上 Persona 前缀。
  - **`POST .../training/exec/test`**：当助手配置里 **`tools` 数组非空** 时，仅允许列表内已挂载的 `toolId` 执行测试；`tools` 为空表示「未显式限制」，与列表页合并展示逻辑兼容。

### 5. OpenClaw 服务小修正

- **文件**：`backend/gateway/src/openclaw/service.ts`
- **行为**：
  - 新增 **`resolveDispatchAgentId(assistantId?)`**，供派发与策略统一解析目标助手。
  - **`getStatus()`** 返回类型补充 **`platformHello`** 字段，与运行时实际返回一致，消除 TypeScript 校验错误。

### 6. 文档与契约

- **文件**：[backend-assistant-config-todo.md](./backend-assistant-config-todo.md)（第四节改为已勾选并描述实际行为）、[frontend-api-contract.md](./frontend-api-contract.md)（补充 `tasks.dispatch`、`taskPrice`、策略错误约定）。

---

## 二、有什么作用

| 能力 | 作用 |
|------|------|
| Persona 前缀 | 让 OpenClaw / 执行端在**同一条用户消息**里看到角色、职责与技能，与控制台「编辑配置」一致，减少「配置了但不生效」的体验断裂。 |
| Deny 约束 | 在网关层对**明显违规意图**做拦截，与训练场 `evaluateChat` 里对约束的「评分参考」互补；HTTP 训练发送与评估路径也统一校验用户侧输入。 |
| 月度 Token 上限 + 粗估累加 | 提供可持久化的**简单用量闸门**（非精确账单）；适合 PoC/内网场景控制成本爆炸。 |
| `taskPrice` vs `minAcceptPrice` | 为后续「任务带价接单」预留网关侧校验点；未传 `taskPrice` 时不因最低价误杀。 |
| 非空 `tools` 时的 exec 限制 | 与「仅挂载工具可执行」的产品语义对齐，避免配置里收窄工具后仍能任意测未挂载工具。 |
| WS 与 HTTP 共用 store + persist | 保证多端入口行为一致，配置与用量不会因入口不同而分叉。 |

---

## 三、为什么要这么做

1. **待办闭环**：[backend-assistant-config-todo.md](./backend-assistant-config-todo.md) 中 GET/PATCH 配置早已具备，若不在派发与聊天路径**消费**配置，前端「编辑配置」仅停留在存储层，无法体现产品承诺。
2. **单一事实来源**：策略集中在 `assistant-config-policy.ts`，HTTP 与 WS 只做 IO 与持久化，避免两套复制逻辑漂移。
3. **渐进式严格**：`tools` 为空不限制 exec、`taskPrice` 可选，降低存量助手与未接计价系统的回归成本。
4. **可观测、可扩展**：拒绝原因通过 `code` / 错误前缀区分，便于前端与运维对接；deny 规则表可按业务继续扩充 `KNOWN_DENY_RULES` 或改为配置驱动。

---

## 四、明确未包含或非目标

- **`costWarningETH`**：仍为展示字段，**不触发拦截**（预警需推送或 UI 提示时可另做）。
- **Token 用量**：为**字符启发式估算**，非 OpenAI usage API 级精度；若要做计费对账，需在下游引入真实计量。
- **可选 WebSocket 专用方法**（如 `assistants.getConfig`）：待办第五节仍为可选，本次未实现。
- **本地 WS 客户端偶发 RSV1/1006**：与本次业务逻辑无直接关系；若需排查，可单独做抓包或换客户端验证。

---

## 五、涉及代码路径（速查）

```
backend/gateway/src/assistants/assistant-config-policy.ts   # 策略纯函数
backend/gateway/src/methods/tasks.ts
backend/gateway/src/methods/openclaw.ts
backend/gateway/src/server/method-router.ts
backend/gateway/src/server/ws-server.ts
backend/gateway/src/server/http-server.ts
backend/gateway/src/openclaw/service.ts
```

---

## 六、与相关文档的关系

| 文档 | 关系 |
|------|------|
| [backend-assistant-config-todo.md](./backend-assistant-config-todo.md) | 需求与清单来源；第四节与本文对应。 |
| [frontend-api-contract.md](./frontend-api-contract.md) | 对外 RPC/HTTP 参数与错误形态。 |
| [README.md](./README.md) | 本目录索引，已链到本文。 |
