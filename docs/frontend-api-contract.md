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
    "assistantId": "aifc-gateway",
    "defaultAgentId": "default",
    "hello": { ... }
  }
}
```

- `openClaw.connected`：OpenClaw 是否已连接。
- `openClaw.source`：`"outbound"`（网关连 OpenClaw）或 `"inbound"`（OpenClaw 桥接连网关）。
- 若未配置或未连接，`openClaw.connected` 为 `false`，可能有 `openClaw.error`。

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
- `kind`：可选，`pc` | `sdk` | `custom`，默认 `pc`。

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
| `openclaw.tasks.dispatch` | 派发任务 | `{ prompt, workspaceId?, assistantId?, taskId? }` | 任务结果 |
| `openclaw.chat.send` | 发送聊天 | `{ sessionKey?, message?, idempotencyKey? }` | 流式结果通过 event 回传 |
| `workspace.list` | 工作区列表 | `{}` | `{ workspaces: [...] }` |
| `tools.list` | 平台工具列表 | `{}` | `{ tools: [...] }` |

---

## 前端对接检查清单

- [ ] 网关 / OpenClaw 状态：使用 `GET /healthz`，不再用 mock。
- [ ] 助手列表：使用 `GET /api/assistants`（或 WS `assistants.list`），不再用 mock。
- [ ] 助手注册向导提交：使用 `POST /api/assistants/register`，Body 为 `{ id, name?, kind? }`。
- [ ] 环境变量配置网关 HTTP/WS base URL（与 [onboarding-manual.md](./onboarding-manual.md) 五、前端与网关联调 一致）。
- [ ] 若使用 `packages/shared` 的 `AssistantRecord`，注意 `provider` 在本网关为 `openclaw` | `sdk` | `pc` | `custom`；与 `native` / `hybrid` 的映射在前端完成。

更多接入步骤见 [onboarding-manual.md](./onboarding-manual.md)。
