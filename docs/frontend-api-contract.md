# 前端 AI 助手对接契约

主前端（AIFutureCity-Web/Aifuturecity）对接本仓 `backend/gateway` 时，应使用下列 HTTP 与 WebSocket 接口替代 mock 数据。基础 URL 由环境变量提供。

**开发待办清单**（按任务拆分的具体步骤与验证项）见 [frontend-todo-checklist.md](./frontend-todo-checklist.md)。

---

## 基础 URL

| 环境变量（示例） | 说明 |
|------------------|------|
| `VITE_GATEWAY_HTTP_URL` | Vite 项目：网关 HTTP base（如 `http://localhost:3001`） |
| `NEXT_PUBLIC_GATEWAY_HTTP_URL` | Next.js 项目：同上 |
| `VITE_GATEWAY_WS_URL` / `NEXT_PUBLIC_GATEWAY_WS_URL` | WebSocket 完整 URL（如 `ws://localhost:3001/ws`） |

联调时通常为 `http://localhost:3001` 与 `ws://localhost:3001/ws`。

---

## HTTP 接口

### GET /healthz

**用途**：网关健康与 OpenClaw 连接状态（Dashboard 状态条）。

**请求**：无 body。

**响应**（200）：

```json
{
  "ok": true,
  "service": "gateway",
  "timestamp": 1234567890123,
  "openClaw": {
    "enabled": true,
    "connected": true,
    "source": "outbound",
    "url": "ws://localhost:18789",
    "platformConnected": true,
    "platformUrl": "ws://localhost:18790",
    "assistantId": "aifc-gateway",
    "defaultAgentId": "default",
    "hello": { ... }
  }
}
```

- `openClaw.connected`：OpenClaw 主连接是否已连接。
- `openClaw.source`：`"outbound"`（网关连 OpenClaw）或 `"inbound"`（OpenClaw 桥接连网关）。
- `openClaw.url`：主连接 WebSocket URL（通常 `ws://localhost:18789`，对应**个人本地助手**）。
- `openClaw.platformConnected`：平台配置 OpenClaw（18790）是否已连接；`true` 时训练场 chat 使用**平台配置助手**。
- `openClaw.platformUrl`：平台连接 URL（如 `ws://localhost:18790`）；仅当配置了 `OPENCLAW_PLATFORM_URL` 时存在。
- 若未配置或未连接，`openClaw.connected` 为 `false`，可能有 `openClaw.error`。

### 显示接入助手类型（个人本地 vs 平台配置）

前端可通过 `GET /healthz`、`GET /api/overview` 或 WebSocket RPC `openclaw.status` 获取 `openClaw` 对象，用于在状态条/训练场页面显示当前 chat 使用的助手类型：

| 条件 | 显示建议 | 说明 |
|------|----------|------|
| `openClaw.platformConnected === true` | **平台配置助手** | 训练场 chat 走平台 OpenClaw（18790），人格来自 `~/.aifuturecity` |
| `openClaw.platformConnected !== true` 且 `openClaw.connected === true` | **个人本地助手** | 训练场 chat 走主连接（18789），人格来自 `~/.openclaw` |
| `openClaw.connected === false` | **未连接** | OpenClaw 未连接，chat 不可用 |

**示例判断逻辑（TypeScript）：**

```ts
const oc = data.openClaw;
const assistantLabel =
  oc.platformConnected
    ? "平台配置助手"
    : oc.connected
      ? "个人本地助手"
      : "未连接";
const detail = oc.platformConnected && oc.platformUrl
  ? `${oc.url} (主) · ${oc.platformUrl} (平台)`
  : oc.url ?? "—";
```

---

### GET /api/assistants

**用途**：助手列表（设备 + OpenClaw 代理合并），与 WebSocket RPC `assistants.list` 同构。

**请求**：无 body。

**响应**（200）：

```json
{
  "assistants": [
    {
      "id": "local-openclaw-001",
      "name": "local-openclaw-001",
      "provider": "openclaw",
      "status": "online"
    },
    {
      "id": "my-pc-001",
      "name": "我的电脑",
      "provider": "pc",
      "status": "offline"
    }
  ]
}
```

**助手项类型**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识 |
| `name` | string | 展示名（可为 id） |
| `provider` | string | `openclaw` \| `sdk` \| `pc` \| `custom` |
| `status` | string | `online` \| `offline` |

**助手在线/离线状态与刷新**：助手的 `status` 由网关根据设备连接与 Inbound 心跳决定（如 Inbound 注册即 online，断开即 offline）。前端应通过 **定时拉取** `GET /api/assistants` 或 `GET /healthz`，或建立 WebSocket 后通过 `assistants.list` / `health` RPC 获取最新状态，以保持列表与状态条与实例连接实时一致；仅加载一次而不刷新会导致接入后仍显示离线。

---

### POST /api/assistants/register

**用途**：登记新助手（如助手注册向导提交）。

**请求**：`Content-Type: application/json`

```json
{
  "id": "my-pc-001",
  "name": "我的电脑",
  "kind": "pc"
}
```

- `id`：必填。
- `name`：可选。
- `kind`：可选，`pc` | `sdk` | `custom` | `openclaw`，默认 `pc`。若助手将由 OpenClaw Inbound 使用，可传 `kind: "openclaw"`。

**响应**（200）：

```json
{
  "ok": true,
  "id": "my-pc-001"
}
```

**错误**（400）：body 无效或缺少 `id` 时返回 `{ "ok": false, "error": "..." }`。

---

### 助手配置（编辑配置功能）

为使前端「编辑配置」持久化并生效，后端需实现以下接口，详见 [backend-assistant-config-todo.md](./backend-assistant-config-todo.md)：

| 方法/路径 | 说明 |
|-----------|------|
| `GET /api/assistants/:id/config` | 获取助手配置（Persona、Tools、Constraints、CostControl） |
| `PATCH /api/assistants/:id/config` | 更新助手配置 |

前端已预留 `getAssistantConfig(id)`、`updateAssistantConfig(id, body)` 客户端方法，后端就绪后即可对接。

---

### 训练场 API

训练场相关接口已实现，详见 [backend-training-todo.md](./backend-training-todo.md)。前端工程对接说明见 AIFutureCity-Web 仓库 `docs/training-api-integration.md`。

| 方法/路径 | 说明 |
|-----------|------|
| `POST /api/assistants/:id/training/chat/send` | 训练场对话：发送消息并获取助手回复（TC，仅 OpenClaw 助手）。可能需等待较长时间（最多约 60s）；建议前端设置请求超时 ≥65s 并提示「等待回复中…」 |
| `GET /api/assistants/:id/tools` | 获取助手工具清单（B3） |
| `POST /api/assistants/:id/training/chat/evaluate` | 聊天能力评估（B1） |
| `POST /api/assistants/:id/training/exec/test` | 工具测试执行（B4） |
| `POST /api/assistants/:id/training/exec/inject` | 工具调用灌输（B5） |
| `POST /api/assistants/:id/training/task/analyze` | 任务理解与拆解（B7） |
| `POST /api/assistants/:id/training/task/chain` | 工具调用链生成（B8） |
| `GET /api/assistants/:id/training/progress` | 获取训练进度（B10） |
| `POST /api/assistants/:id/training/progress` | 更新训练进度（B10） |
| `GET /api/assistants/:id/tasks` | 助手关联任务列表（B9） |
| `POST /api/assistants/:id/training/sessions` | 创建训练会话（B11） |
| `GET /api/assistants/:id/training/sessions/:sessionId` | 获取训练会话详情（B11） |

---

### GET /api/overview

**用途**：概览（设备列表、会话列表、OpenClaw 状态），可用于调试或概览页。

**响应**（200）：

```json
{
  "devices": [ { "id", "kind", "status", "lastSeenAt", "name?" } ],
  "sessions": [ { "id", "title", "status" } ],
  "openClaw": { /* 同 /healthz 中的 openClaw */ }
}
```

---

### GET /api/openclaw/agents

**用途**：OpenClaw 侧原始代理列表（可选）。

**响应**（200）：由 OpenClaw 返回的原始结构（如 `{ agents: [...] }`）。若 OpenClaw 未连接可能 500。

---

## WebSocket RPC

**连接**：`${GATEWAY_WS_URL}`，默认 `ws://localhost:3001/ws`。

**协议**：JSON-RPC 风格。请求帧：`{ "type": "req", "id": "<string>", "method": "<method>", "params": <object> }`。响应帧：`{ "type": "res", "id": "<string>", "ok": true|false, "result"?: <object>, "error"?: { "code", "message" } }`。

**首次握手**：连接后先发送 `connect`，可选带 `params.device` 上报本机设备（见 [onboarding-manual.md](./onboarding-manual.md) 四、方式 B）。

### 与 AI 助手相关的 RPC 方法

| 方法 | 说明 | 参数示例 | 返回/说明 |
|------|------|----------|------------|
| `connect` | 握手，建立连接 | `{}` 或 `{ device: { id, name?, kind? } }` | 返回 `hello-ok` 与 `features.methods` |
| `health` | 系统健康（含设备数、OpenClaw 状态） | `{}` | `{ ok, devicesOnline, timestamp, openClaw }` |
| `devices.list` | 设备列表 | `{}` | `{ devices: [...] }` |
| `assistants.list` | 助手列表（与 GET /api/assistants 同构） | `{}` | `{ assistants: [...] }` |
| `assistants.register` | 登记助手 | `{ id, name?, kind? }` | `{ ok: true, id }` |
| `openclaw.status` | OpenClaw 状态 | `{}` | 同 /healthz 中的 openClaw |
| `openclaw.agents.list` | OpenClaw 代理列表 | `{}` | 原始 agents 列表 |
| `tasks.dispatch` | 派发任务（与 OpenClaw 解耦的聚合入口） | `{ prompt, workspaceId?, assistantId?, taskId?, taskPrice? }` | 成功：`{ accepted: true, provider, dispatch? \| plan? }`。策略拒绝：`{ accepted: false, provider: "policy", code, error }`（`code` 如 `CONSTRAINT_BLOCKED`、`COST_LIMIT`、`PRICE_TOO_LOW`）。 |
| `openclaw.tasks.dispatch` | 直连 OpenClaw 派发 | 同上 + `taskPrice?` | 成功为 OpenClaw 返回体；若触发助手策略（约束 / 月度 Token / 最低价）则 WS 返回 `ok: false`，`message` 以 `CONSTRAINT_BLOCKED:`、`COST_LIMIT:`、`PRICE_TOO_LOW:` 开头。 |
| `openclaw.chat.send` | 发送聊天 | `{ sessionKey?, message?, idempotencyKey?, usePlatformPersona?, assistantId?, taskPrice? }` | 流式结果通过 event 回传。`sessionKey` 以 `training-` 开头时从后缀解析 `assistantId`；亦可显式传 `assistantId`。若配置了 Persona，会前缀到 message。策略拒绝时同 `openclaw.tasks.dispatch`。传 `usePlatformPersona: true` 或 `sessionKey` 以 `training-` 开头时，使用平台人格 OpenClaw（18790）；否则使用主连接（18789）。 |
| `workspace.list` | 工作区列表 | `{}` | `{ workspaces: [...] }` |
| `tools.list` | 平台工具列表 | `{}` | `{ tools: [...] }` |

派发与聊天会按助手配置**预填 Persona**、校验 **constraints（deny 规则）**、**月度 Token 上限**（`monthlyTokenLimitM` vs `tokenUsedThisMonthM`，成功后粗估累加用量），以及可选的 **`taskPrice` vs `minAcceptPrice`**。

---

## 租户与鉴权

当前网关采用**单租户**（默认租户），不解析请求身份，前端无需携带任何鉴权或租户 Header。后续启用多租户/用户解析时，将要求请求头或 WS 参数中携带身份信息；届时主前端仓库（AIFutureCity-Web/Aifuturecity）中的 `docs/gateway-auth-and-tenant.md` 会说明请求约定与前端需配合的鉴权、租户传递方式。

---

## 前端对接检查清单

- [ ] 网关 / OpenClaw 状态：使用 `GET /healthz`，不再用 mock。
- [ ] 助手列表：使用 `GET /api/assistants`（或 WS `assistants.list`），不再用 mock。
- [ ] 助手注册向导提交：使用 `POST /api/assistants/register`，Body 为 `{ id, name?, kind? }`。
- [ ] 环境变量配置网关 HTTP/WS base URL（与 [onboarding-manual.md](./onboarding-manual.md) 五、前端与网关联调 一致）。
- [ ] 若使用 `packages/shared` 的 `AssistantRecord`，注意 `provider` 在本网关为 `openclaw` | `sdk` | `pc` | `custom`；与 `native` / `hybrid` 的映射在前端完成。

更多接入步骤见 [onboarding-manual.md](./onboarding-manual.md)。
