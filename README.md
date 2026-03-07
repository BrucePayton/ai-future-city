# AIFutureCity

AIFutureCity 是一个围绕 AI 助手、设备接入、协作工作区和平台后端构建的全栈 monorepo。当前仓库已经按运行职责拆分为 `client`、`web`、`backend` 三个业务层，并保留 `packages`、`infra`、`skills` 等支撑层。

## Current Structure

主 Web 门户为**独立仓库** `AIFutureCity-Web/Aifuturecity`（Vite + React），本仓的 `web/console` 为平台网关的**开发/调试控制台**（可选）。

```text
ai-future-city/
├── backend/        # 平台后端服务
├── client/         # 设备端 / 本地宿主侧能力
├── web/            # 网关开发/调试控制台（可选）
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

网关开发/调试控制台（可选；主前端见独立仓库 AIFutureCity-Web/Aifuturecity）。

- `web/console`
  - Next.js 控制台应用
  - 直接接入 `backend/gateway` 的 `/healthz` 和 WebSocket RPC，用于联调与调试

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
# 仅启动网关（供外部前端或本仓控制台连接）
pnpm dev:backend

# 启动网关 + 本仓开发控制台
pnpm dev:backend
pnpm dev:web

pnpm dev:client
```

### Start each layer directly

```bash
# Backend（仅网关时，外部前端可连接此端口）
pnpm --dir backend run dev:gateway
pnpm --dir backend run dev:knowledge-service
pnpm --dir backend run dev:recommendation-service

# Web（本仓调试控制台）
pnpm --dir web run dev

# Client
pnpm --dir client run dev:agent-sdk
pnpm --dir client run test:openclaw:connection
pnpm --dir client run test:openclaw:openai
```

## Local OpenClaw Integration

当前仓库已完成本地 OpenClaw 联调链路：`backend/gateway` 可连接本地 OpenClaw，`web/console` 与主前端可读取健康检查及 WebSocket RPC，`client/openclaw-adapter` 可单独验证连接。

**接入本地 OpenClaw 助手（四步）：**

1. **运行 OpenClaw**：在本机启动 OpenClaw，默认 WebSocket 端口 `18789`（`lsof -i :18789` 确认）。
2. **获取 Gateway Token**：例如 `cat ~/.openclaw/config.json5 | grep token`，或参见 OpenClaw 文档。
3. **配置环境变量**：在仓库根目录 `.env.local` 中设置 `OPENCLAW_LOCAL_URL=ws://localhost:18789`、`OPENCLAW_LOCAL_TOKEN=<token>`、`OPENCLAW_LOCAL_AGENT_ID=default`（可复制 `.env.example` 后填写）。
4. **重启网关并验证**：执行 `pnpm dev:backend`；可选运行 `pnpm test:client:connection` 验证连通性；主前端 Dashboard 顶部应显示「网关正常 · OpenClaw 已连接」。

详细步骤与验证说明见 [docs/local-openclaw.md](docs/local-openclaw.md)。**按场景的接入操作手册**见 [docs/onboarding-manual.md](docs/onboarding-manual.md)。

示例 `.env.local` 片段（网关 + 本仓控制台/主前端联调）：

```bash
OPENCLAW_LOCAL_URL=ws://localhost:18789
OPENCLAW_LOCAL_TOKEN=...
OPENCLAW_LOCAL_AGENT_ID=default
AIFC_GATEWAY_PORT=3001
NEXT_PUBLIC_GATEWAY_HTTP_URL=http://localhost:3001
NEXT_PUBLIC_GATEWAY_WS_URL=ws://localhost:3001/ws
```

## 与外部前端联调

主前端仓库为 **AIFutureCity-Web/Aifuturecity**（独立仓库）。联调时：

1. 在本仓先启动网关：`pnpm dev:backend`（或 `pnpm --dir backend run dev:gateway`），默认端口 **3001**（`AIFC_GATEWAY_PORT`）。
2. 在外部前端仓库配置环境变量：`VITE_GATEWAY_HTTP_URL=http://localhost:3001`、`VITE_GATEWAY_WS_URL=ws://localhost:3001/ws`，然后启动前端。
3. 网关已开启 CORS（`Access-Control-Allow-Origin: *`），前端直连 `http://localhost:3001` 即可，无需同源。

生产部署时可用 Nginx 统一入口：前端静态资源 + `/api`、`/ws` 反代到 gateway。

## Workspace Validation

当前主工作区使用 `pnpm workspace` 管理。常用校验命令：

```bash
pnpm typecheck
pnpm build
```
