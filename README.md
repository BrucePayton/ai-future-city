# AIFutureCity

AIFutureCity 是一个围绕 AI 助手、设备接入、协作工作区和平台后端构建的全栈 monorepo。当前仓库已经按运行职责拆分为 `client`、`web`、`backend` 三个业务层，并保留 `packages`、`infra`、`skills` 等支撑层。

## Current Structure

```text
ai-future-city/
├── backend/        # 平台后端服务
├── client/         # 设备端 / 本地宿主侧能力
├── web/            # 浏览器前端
├── packages/       # 跨层共享代码
├── infra/          # 基础设施与部署配置
├── skills/         # Skill 资源文件
├── docs/           # 架构与协议文档
├── contracts/      # 智能合约
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Layer Responsibilities

### `backend/`

平台服务端代码，负责网关、OpenClaw 接入桥接，以及独立的 Python 服务。

- `backend/gateway`
  - Node.js 平台网关
  - 提供 HTTP 和 WebSocket RPC
  - 已接入本地 OpenClaw，可通过适配器直接访问 `agents.list`、任务派发等能力
- `backend/services/knowledge-service`
  - FastAPI 知识与评估服务
- `backend/services/recommendation-service`
  - FastAPI 推荐与洞察服务

### `client/`

设备侧、本地宿主侧、OpenClaw 接入侧代码。

- `client/agent-sdk`
  - 设备轻量 SDK
- `client/openclaw-adapter`
  - 本地 OpenClaw 直连接入适配器
  - 包含 WebSocket RPC / OpenAI REST 验证脚本
- `client/extensions/aifuturecity`
  - OpenClaw 侧插件骨架
  - 用于 OpenClaw 主动出站连接平台

### `web/`

浏览器端应用。

- `web/console`
  - Next.js 控制台应用
  - 直接接入 `backend/gateway` 的 `/healthz` 和 WebSocket RPC

### `packages/`

跨层共享的 TypeScript 代码，不直接作为独立业务服务运行。

- `packages/protocol`
  - 共享协议类型
- `packages/device-sdk`
  - 设备插件接口与类型
- `packages/tool-registry`
  - 工具注册表抽象
- `packages/shared`
  - 通用领域类型
- `packages/db`
  - 数据模型与数据库层占位

### `infra/`

部署与基础设施配置。

- Docker Compose
- Nginx
- PostgreSQL 初始化脚本
- InfluxDB / Weaviate 配置

### `skills/`

平台 Skill 资源文件，作为能力资产存在，不归属前端或后端服务源码。

## Run Commands

### From repo root

```bash
pnpm dev:backend
pnpm dev:web
pnpm dev:client
```

### Start each layer directly

```bash
# Backend
pnpm --dir backend run dev:gateway
pnpm --dir backend run dev:knowledge-service
pnpm --dir backend run dev:recommendation-service

# Web
pnpm --dir web run dev

# Client
pnpm --dir client run dev:agent-sdk
pnpm --dir client run test:openclaw:connection
pnpm --dir client run test:openclaw:openai
```

## Local OpenClaw Integration

当前仓库已经完成一条本地联调链路：

- `backend/gateway` 可连接本地 OpenClaw
- `web/console` 可读取 gateway 的健康检查和 WebSocket RPC
- `client/openclaw-adapter` 可单独验证本地 OpenClaw 的 WebSocket RPC 与 OpenAI REST 接口

建议在根目录使用 `.env.local` 配置本地联调参数，例如：

```bash
OPENCLAW_LOCAL_URL=ws://localhost:18789
OPENCLAW_LOCAL_TOKEN=...
OPENCLAW_LOCAL_AGENT_ID=default
AIFC_GATEWAY_PORT=3001
NEXT_PUBLIC_GATEWAY_HTTP_URL=http://localhost:3001
NEXT_PUBLIC_GATEWAY_WS_URL=ws://localhost:3001/ws
```

## Workspace Validation

当前主工作区使用 `pnpm workspace` 管理。常用校验命令：

```bash
pnpm typecheck
pnpm build
```
