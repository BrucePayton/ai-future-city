# AIFutureCity 接入操作手册

本文档为 **接入操作手册**，按场景给出从零到可用的具体步骤与验证方法。详细协议与架构见 [local-openclaw.md](./local-openclaw.md)、[aifuturecity_architecture.md](./aifuturecity_architecture.md)。

---

## 前置条件

- 已克隆 **ai-future-city** 仓库，并在仓库根目录可执行 `pnpm`。
- 需要接入 **OpenClaw** 时：本机已安装并可启动 [OpenClaw](https://github.com/openclaw/openclaw)，且已知其 WebSocket 地址与 Gateway Token。
- 需要接入 **主前端** 时：已克隆 **AIFutureCity-Web/Aifuturecity** 并可按其 README 启动。

---

## 一、场景速查

| 场景 | 说明 | 对应章节 |
|------|------|----------|
| **网关 + OpenClaw 都在本机** | 开发/联调：网关连本机 OpenClaw | [二、本机 Outbound 接入](#二本机-outbound-接入) |
| **OpenClaw 在本机，网关在服务器** | 个人 PC 的 OpenClaw 接入远端网关 | [三、本机 OpenClaw 入站接入](#三本机-openclaw-入站接入) |
| **仅登记 PC 助手设备** | 不跑 OpenClaw，只把 PC 登记为助手（列表展示/在线状态） | [四、PC 助手设备接入](#四pc-助手设备接入) |
| **前端连网关** | 主前端或控制台连本仓网关 | [五、前端与网关联调](#五前端与网关联调) |

---

## 二、本机 Outbound 接入

**适用**：网关和 OpenClaw 都在同一台机器（如本地开发机）。

### 步骤 1：启动 OpenClaw

- OpenClaw 监听 WebSocket，默认端口 **18789**。
- 启动后确认端口在监听：

```bash
lsof -i :18789
```

### 步骤 2：获取 OpenClaw Token

从 OpenClaw 配置中获取用于网关连接的 token，例如：

```bash
cat ~/.openclaw/config.json5 | grep token
```

### 步骤 3：配置环境变量

在 **ai-future-city 仓库根目录** 创建或编辑 `.env.local`：

```bash
OPENCLAW_LOCAL_URL=ws://localhost:18789
OPENCLAW_LOCAL_TOKEN=<上一步拿到的 token>
OPENCLAW_LOCAL_AGENT_ID=default
```

端口若非 18789，请修改 `OPENCLAW_LOCAL_URL` 中的端口。

### 步骤 4：启动网关

在仓库根目录执行：

```bash
pnpm dev:backend
```

看到类似 `AIFutureCity gateway listening on http://localhost:3001 (ws: /ws ...)` 即表示网关已启动。

### 步骤 5：验证

- **脚本验证**（在仓库根目录）：

```bash
pnpm test:client:connection
```

或：

```bash
pnpm --dir client run test:openclaw:connection
```

- **前端验证**：打开主前端 Dashboard，状态栏应为 **「网关正常 · OpenClaw 已连接」**。
- **HTTP 验证**：`curl -s http://localhost:3001/healthz` 中 `openClaw.connected` 应为 `true`。

---

## 三、本机 OpenClaw 入站接入

**适用**：OpenClaw 在你本机，网关在远端服务器（服务器无法主动连你本机）。

思路：在本机运行 **桥接脚本**，由本机主动连网关的入站 WebSocket，再把网关下发的请求转发到本机 OpenClaw。

### 步骤 1：服务器侧配置

在 **部署网关的服务器/环境** 中配置入站 token（可与 outbound 共用同一 token）：

```bash
OPENCLAW_INBOUND_TOKEN=<与桥接端约定好的 token>
```

可选：自定义入站路径（默认 `/ws/openclaw-inbound`）：

```bash
OPENCLAW_INBOUND_WS_PATH=/ws/openclaw-inbound
```

重启网关后，启动日志中应出现 `OpenClaw inbound: /ws/openclaw-inbound`（或你配置的路径）。

### 步骤 2：本机准备 OpenClaw

- 在本机启动 OpenClaw（如 `ws://localhost:18789`）。
- 确认本机 OpenClaw 的 **连接 token**（用于桥接连本机 OpenClaw）。

### 步骤 3：本机配置桥接环境

在 **本机 ai-future-city 仓库** 的 `.env.local`（或环境变量）中配置：

```bash
# 网关入站 WebSocket 地址（替换为实际服务器地址与端口）
GATEWAY_WS_URL=wss://your-gateway-server:3001/ws/openclaw-inbound
# 与服务器 OPENCLAW_INBOUND_TOKEN 一致
OPENCLAW_INBOUND_TOKEN=<与服务器一致>
# 本机 OpenClaw 地址与 token
OPENCLAW_LOCAL_URL=ws://localhost:18789
OPENCLAW_LOCAL_TOKEN=<本机 OpenClaw token>
```

### 步骤 4：运行桥接

在 **client/openclaw-adapter** 目录下执行：

```bash
pnpm bridge:inbound
```

看到 **“Registered with gateway as ...”** 即表示本机 OpenClaw 已通过入站接入。保持该进程运行；关闭后网关侧将无法使用该 OpenClaw。

### 步骤 5：验证

- 在任意可访问网关的客户端调用 `openclaw.status`，应返回 `connected: true`、`source: "inbound"`。
- 前端 Dashboard 应显示 **OpenClaw 已连接**。

---

## 四、PC 助手设备接入

**适用**：不跑 OpenClaw，仅将「个人 PC」登记为助手设备，出现在 `assistants.list` / `devices.list` 中，并可选地通过 WebSocket 上报在线状态。

### 方式 A：HTTP 注册（先登记，后上线）

在可访问网关的机器上执行（替换为实际网关地址与端口）：

```bash
curl -X POST http://localhost:3001/api/assistants/register \
  -H "Content-Type: application/json" \
  -d '{"id":"my-pc-001","name":"我的电脑","kind":"pc"}'
```

- `id` 必填；`name`、`kind`（`pc` | `sdk` | `custom`）可选，默认 `kind: "pc"`。
- 登记后设备默认离线；当该 PC 通过 WebSocket 用相同 `id` 连接并带 `device` 信息时，会变为在线。

### 方式 B：WebSocket 连接时带 device（即连即接入）

客户端连接网关 WebSocket（如 `/ws`）后，首次 RPC 调用 `connect` 时在 `params` 中带上 `device`：

```json
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "device": {
      "id": "my-pc-001",
      "name": "我的电脑",
      "kind": "pc"
    }
  }
}
```

- `device.id` 必填；`device.name`、`device.kind` 可选。
- 断开连接后，该设备会在网关侧被标记为离线。

### 方式 C：WebSocket RPC 注册

通过网关 WebSocket 调用 `assistants.register`（与 HTTP 行为一致）：

```json
{
  "type": "req",
  "id": "2",
  "method": "assistants.register",
  "params": { "id": "my-pc-002", "name": "办公室 PC", "kind": "pc" }
}
```

接入后的 PC 助手会与 OpenClaw 返回的助手一起出现在 `assistants.list` 中。

---

## 五、前端与网关联调

**前端 AI 助手对接**（接口路径、请求/响应形状、WebSocket RPC 列表）见 [frontend-api-contract.md](./frontend-api-contract.md)。按该契约用真实网关接口替代 mock 即可打通助手列表、状态与注册。

### 启动网关

在 ai-future-city 根目录：

```bash
pnpm dev:backend
```

默认 HTTP 端口 **3001**，WebSocket 路径 **/ws**。

### 主前端（Aifuturecity）连接网关

- 在主前端项目中配置网关地址，例如：
  - `NEXT_PUBLIC_GATEWAY_HTTP_URL=http://localhost:3001`
  - `NEXT_PUBLIC_GATEWAY_WS_URL=ws://localhost:3001/ws`
- 若前端与网关不同源，需在网关侧已开启 CORS，或在前端配置代理到网关。

### 确认连通

- 打开前端 Dashboard，查看 **网关状态** 与 **OpenClaw 状态**。
- 浏览器开发者工具 Network 中可查看对网关的请求与 WebSocket 连接。

---

## 六、环境变量速查

| 变量 | 说明 | 使用场景 |
|------|------|----------|
| `OPENCLAW_LOCAL_URL` | OpenClaw WebSocket 地址 | Outbound 接入、本机桥接连本地 OpenClaw |
| `OPENCLAW_LOCAL_TOKEN` | OpenClaw 连接 token | Outbound 接入、本机桥接认证本地 OpenClaw |
| `OPENCLAW_LOCAL_AGENT_ID` | 默认 agent id | Outbound 接入 |
| `OPENCLAW_INBOUND_TOKEN` | 网关入站注册 token | 网关启用入站、本机桥接注册 |
| `OPENCLAW_INBOUND_WS_PATH` | 入站 WebSocket 路径 | 网关、默认 `/ws/openclaw-inbound` |
| `GATEWAY_WS_URL` | 网关入站完整 WebSocket URL | 本机桥接连接网关 |
| `AIFC_GATEWAY_PORT` | 网关 HTTP 端口 | 默认 3001 |
| `AIFC_GATEWAY_WS_PATH` | 网关主 WebSocket 路径 | 默认 `/ws` |

更多见仓库根目录 `.env.example`。

---

## 七、验证命令速查

| 目的 | 命令 |
|------|------|
| 网关健康（含 OpenClaw 状态） | `curl -s http://localhost:3001/healthz` |
| 助手列表（合并） | `curl -s http://localhost:3001/api/assistants` |
| 网关概览（设备/会话/OpenClaw） | `curl -s http://localhost:3001/api/overview` |
| OpenClaw 代理列表 | `curl -s http://localhost:3001/api/openclaw/agents` |
| OpenClaw 连通性脚本 | `pnpm test:client:connection`（仓库根目录） |
| 登记 PC 助手 | `curl -X POST http://localhost:3001/api/assistants/register -H "Content-Type: application/json" -d '{"id":"my-pc-001","name":"我的电脑","kind":"pc"}'` |

---

## 八、常见问题

**Q：Dashboard 显示「OpenClaw 未连接」**  
- 若为 Outbound：确认 OpenClaw 已启动、`.env.local` 中 `OPENCLAW_LOCAL_URL` 与 `OPENCLAW_LOCAL_TOKEN` 正确、网关已重启。  
- 若为入站：确认本机桥接 `pnpm bridge:inbound` 正在运行，且 `GATEWAY_WS_URL`、`OPENCLAW_INBOUND_TOKEN` 与服务器一致。

**Q：端口 3001 已被占用**  
- 结束占用进程：`kill $(lsof -ti :3001)`（或改用其他端口 `AIFC_GATEWAY_PORT=3002 pnpm dev:backend`）。

**Q：入站与 Outbound 同时配置时谁生效？**  
- 若已有入站连接，网关 **优先使用入站**；否则使用 Outbound。两者可并存，按连接情况自动切换。

**Q：桥接断开后怎么办？**  
- 网关会将该 OpenClaw 视为断开；重新运行 `pnpm bridge:inbound` 即可再次接入。

---

以上为接入操作手册的完整内容。变更与细节以 [local-openclaw.md](./local-openclaw.md) 及代码为准。
