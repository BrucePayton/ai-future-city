# AIFutureCity Agents Guide

## Monorepo layout

- `apps/gateway`: 平台核心后端，负责 HTTP、WebSocket RPC、设备接入、任务编排和会话管理。
- `apps/agent-sdk`: 设备侧轻量 SDK，负责连接平台、心跳上报和本地执行桥接。
- `packages/*`: 共享协议、类型、注册表和基础设施抽象。
- `extensions/*`: 外部设备或第三方宿主插件。
- `services/*`: Python 独立服务，承接知识、推荐等 AI 计算任务。

## Editing guidance

- 优先在 `apps/gateway` 中放置平台后端逻辑，不要把服务端流程塞进客户端目录。
- 共享类型和协议优先放入 `packages/protocol`、`packages/shared`、`packages/device-sdk`。
- OpenClaw 相关对接优先复用 `packages/openclaw-adapter` 与 `extensions/aifuturecity`。
- 只有在某个模块真正需要独立发布或独立部署时，再把它提升为 `apps/*` 或 `services/*`。
