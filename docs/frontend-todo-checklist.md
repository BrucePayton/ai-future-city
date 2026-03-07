# 前端仓库开发待办清单（AIFutureCity-Web / Aifuturecity）

本文档面向 **主前端仓库**（AIFutureCity-Web/Aifuturecity），用于按网关真实接口替换 mock、打通 AI 助手功能。接口定义与请求/响应形状见 [frontend-api-contract.md](./frontend-api-contract.md)。

---

## 一、环境与基础

- [ ] **配置网关 base URL**  
  - 在项目根目录 `.env.development` 或 `.env.local` 中增加（按实际框架选用）：  
    - `VITE_GATEWAY_HTTP_URL=http://localhost:3001`（Vite）  
    - `VITE_GATEWAY_WS_URL=ws://localhost:3001/ws`（Vite）  
    - 或 `NEXT_PUBLIC_GATEWAY_HTTP_URL` / `NEXT_PUBLIC_GATEWAY_WS_URL`（Next.js）  
  - 联调时确保 ai-future-city 网关已启动：`pnpm dev:backend`（在 ai-future-city 根目录）。

- [ ] **封装网关 HTTP 客户端**  
  - 提供统一方法调用网关 HTTP 接口，例如：  
    - `getHealth()` → `GET ${GATEWAY_HTTP_URL}/healthz`  
    - `getAssistants()` → `GET ${GATEWAY_HTTP_URL}/api/assistants`  
    - `registerAssistant(body)` → `POST ${GATEWAY_HTTP_URL}/api/assistants/register`  
  - 使用环境变量中的 base URL，便于切换环境。

- [ ] **（可选）封装或复用 WebSocket RPC 客户端**  
  - 若需任务派发、聊天等，连接 `${GATEWAY_WS_URL}`，按 [frontend-api-contract.md](./frontend-api-contract.md) 中的 RPC 协议实现请求/响应帧。  
  - 至少支持：`connect`、`assistants.list`、`openclaw.status`、`openclaw.tasks.dispatch`、`openclaw.chat.send`。

---

## 二、移除 Mock、接入真实接口

### 2.1 网关与 OpenClaw 状态（Dashboard 状态条）

- [ ] **定位当前展示「网关 / OpenClaw 状态」的代码**  
  - 例如 Dashboard 顶部的状态条、健康指示器。

- [ ] **移除该处对 mock 状态数据的依赖**  
  - 删除或注释掉 mock 的网关/OpenClaw 状态对象或常量。

- [ ] **改为调用真实接口**  
  - 使用 `GET /healthz`（如通过 `getHealth()`）。  
  - 根据返回的 `openClaw.connected`、`openClaw.source`、`openClaw.error` 渲染状态（如「网关正常 · OpenClaw 已连接」或「OpenClaw 未连接」）。

- [ ] **（可选）轮询或 WS 刷新**  
  - 若需近实时状态，可定时轮询 `/healthz` 或在建立 WebSocket 后通过 `health` RPC 更新。

---

### 2.2 助手列表

- [ ] **定位展示「AI 助手列表」的页面/组件**  
  - 例如 Dashboard 助手卡片、助手管理页、侧边栏助手列表等。

- [ ] **移除该处对 mock 助手列表的依赖**  
  - 删除或注释 mock 的 `assistants` 数组或假数据。

- [ ] **改为调用真实接口**  
  - 使用 `GET /api/assistants`（如通过 `getAssistants()`）。  
  - 响应形状：`{ assistants: Array<{ id, name, provider, status }> }`，见 [frontend-api-contract.md](./frontend-api-contract.md)。

- [ ] **类型与展示**  
  - 定义或复用类型：`id: string`、`name: string`、`provider: "openclaw"|"sdk"|"pc"|"custom"`、`status: "online"|"offline"`。  
  - 若使用本仓 `packages/shared` 的 `AssistantRecord`（provider 为 openclaw | native | hybrid），在前端做一次 provider 映射或扩展类型以兼容网关的 `sdk` / `pc` / `custom`。

- [ ] **加载与错误态**  
  - 请求中展示 loading；请求失败时展示错误提示或降级 UI。

---

### 2.3 助手注册向导（新增助手）

- [ ] **定位「添加助手」/「助手注册向导」提交逻辑**  
  - 例如向导最后一步的「完成」或「提交」按钮。

- [ ] **移除该处对 mock 提交的依赖**  
  - 删除或注释掉 mock 的“登记成功”或假 ID 返回。

- [ ] **改为调用真实接口**  
  - 使用 `POST /api/assistants/register`，Body：`{ id: string, name?: string, kind?: "pc"|"sdk"|"custom" }`（如通过 `registerAssistant({ id, name, kind })`）。  
  - 成功：响应 `{ ok: true, id }`，可跳转助手列表或详情并刷新列表。  
  - 失败：根据 400 响应 `{ ok: false, error }` 展示错误信息。

- [ ] **表单校验**  
  - 至少保证 `id` 必填且符合业务规则（如非空、唯一性提示）。

---

### 2.4 任务派发与聊天（若当前为 mock）

- [ ] **定位任务派发 / 与助手聊天的入口**  
  - 例如「派发任务」按钮、聊天输入框、会话页。

- [ ] **移除 mock 派发或 mock 聊天回复**  
  - 删除假的任务结果或假的消息流。

- [ ] **改为通过 WebSocket RPC**  
  - 建立连接后调用 `openclaw.tasks.dispatch`（params: `prompt`, `workspaceId`, `assistantId?`, `taskId?`）。  
  - 或 `openclaw.chat.send`（params: `sessionKey`, `message`, `idempotencyKey?`）；流式结果通过事件或回调处理。  
  - 接口说明见 [frontend-api-contract.md](./frontend-api-contract.md) 的 WebSocket RPC 表。

---

## 三、联调与验证

- [ ] **本地联调**  
  - 在 ai-future-city 根目录启动网关：`pnpm dev:backend`。  
  - 启动前端，确认环境变量指向 `http://localhost:3001` 与 `ws://localhost:3001/ws`。  
  - 打开 Dashboard：网关状态、OpenClaw 状态、助手列表均来自真实接口，无 mock。

- [ ] **助手列表**  
  - 若已配置 OpenClaw 或已登记 PC 助手，列表应出现对应项；否则可为空数组但不报错。

- [ ] **助手注册**  
  - 走一遍注册向导，提交后列表或详情中能看到新登记的助手（状态可为离线，直到该设备通过 WS 连接上报）。

- [ ] **（可选）任务/聊天**  
  - 若已实现 WS RPC，派发一次任务或发送一条聊天，确认请求到达网关并收到响应或流式事件。

---

## 四、收尾

- [ ] **删除或隔离废弃 mock 数据**  
  - 移除或注释不再使用的 mock 常量、JSON 文件、或 mock 适配层，避免与真实接口混用。

- [ ] **更新 README 或开发文档**  
  - 说明本地开发需先启动 ai-future-city 网关，并配置 `VITE_*` / `NEXT_PUBLIC_*` 网关 URL。  
  - 可附链接：ai-future-city 的 [onboarding-manual.md](https://github.com/.../blob/main/docs/onboarding-manual.md) 与 [frontend-api-contract.md](https://github.com/.../blob/main/docs/frontend-api-contract.md)（按实际仓库地址替换）。

- [ ] **（可选）错误监控与降级**  
  - 网关不可用时，前端可展示「网关未连接」或降级 UI，避免白屏或未处理异常。

---

## 快速参考

| 能力           | 接口 / RPC                    | 契约章节           |
|----------------|-------------------------------|--------------------|
| 网关/OpenClaw 状态 | `GET /healthz`                | frontend-api-contract § GET /healthz |
| 助手列表       | `GET /api/assistants`         | frontend-api-contract § GET /api/assistants |
| 登记助手       | `POST /api/assistants/register` | frontend-api-contract § POST /api/assistants/register |
| 任务/聊天      | WS `openclaw.tasks.dispatch` / `openclaw.chat.send` | frontend-api-contract § WebSocket RPC |

以上清单完成后，前端 AI 助手相关功能将全部使用网关真实接口，不再依赖 mock 数据。
