# Client

设备端和宿主侧能力统一放在这里：

- `agent-sdk/`: 设备轻量 SDK
- `openclaw-adapter/`: 本地 OpenClaw 直连接入与测试脚本
- `extensions/aifuturecity/`: OpenClaw 侧平台插件

## 启动

```bash
pnpm --dir client run dev:agent-sdk
pnpm --dir client run test:openclaw:connection
pnpm --dir client run test:openclaw:openai
```
