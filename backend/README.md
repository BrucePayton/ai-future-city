# Backend

平台服务端能力统一放在这里：

- `gateway/`: Node.js 网关，负责 HTTP、WebSocket RPC、OpenClaw 接入
- `services/knowledge-service/`: Python 知识与评估服务
- `services/recommendation-service/`: Python 推荐与洞察服务

## 启动

```bash
pnpm --dir backend run dev:gateway
pnpm --dir backend run dev:knowledge-service
pnpm --dir backend run dev:recommendation-service
```
