# `@aifc/openclaw-adapter`

Phase 0 的最小 OpenClaw 接入包，覆盖文档中的两条本地验证路径：

- 路径 B：WebSocket RPC 直连 `OpenClawAdapter`
- 路径 C：OpenAI 兼容 REST `OpenClawOpenAIProxy`

## 快速开始

在仓库根目录准备 `.env.local`：

```bash
OPENCLAW_LOCAL_URL=ws://localhost:18789
OPENCLAW_LOCAL_TOKEN=...
OPENCLAW_LOCAL_AGENT_ID=default
OPENCLAW_CHAT_SESSION_KEY=test-workspace-001
OPENCLAW_BASE_URL=http://localhost:18789
OPENCLAW_REST_TOKEN=...
```

安装依赖后可运行：

```bash
pnpm test:connection
pnpm test:openai
```

## 当前能力

- `connect()`：等待 `connect.challenge` 并完成 OpenClaw `connect` 握手
- `dispatchTask()`：通过 `agent` RPC 派发任务
- `sendChat()`：通过 `chat.send` 接收 `chat` 流式事件
- `inspectGateway()`：检查 `agents.list`、`health`、`usage.cost`、`config.get`，并可选调用 `tools.invoke`
