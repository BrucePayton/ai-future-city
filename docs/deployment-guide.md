# AIFutureCity 技能交易平台部署指南

本文档提供 AIFutureCity 技能交易平台的完整部署指南，支持多种部署模式。

---

## 一、系统架构

### 1.1 架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           客户端                                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │   Web 前端      │  │   移动端 H5     │  │   OpenClaw 客户端       │   │
│  │  Aifuturecity  │  │   (浏览器)      │  │   (本地/云端)           │   │
│  └────────┬────────┘  └────────┬────────┘  └───────────┬─────────────┘   │
└───────────┼────────────────────┼─────────────────────┼──────────────────┘
            │                    │                     │
            ▼                    ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          API Gateway (Port 3001)                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  REST API                    │  WebSocket                           ││
│  │  ─────────                   │  ─────────                           ││
│  │  • 技能商店 API              │  • 实时任务状态                       ││
│  │  • 任务市场 API              │  • 团队协作                          ││
│  │  • 集群管理 API              │  • 通知推送                          ││
│  │  • 团队管理 API              │                                       ││
│  │  • 支付/钱包 API             │                                       ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  PostgreSQL      │   │  Redis           │   │  OpenClaw 集群  │
│  (数据存储)       │   │  (缓存/队列)     │   │  (任务执行)      │
│  • 用户/租户      │   │  • 会话缓存       │   │  • 本地模式     │
│  • 技能/订单      │   │  • 任务队列       │   │  • 云端模式     │
│  • 钱包/交易      │   │  • 实时订阅       │   │  • 混合模式     │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

### 1.2 核心模块

| 模块 | 说明 |
|------|------|
| **API Gateway** | 统一入口，处理 REST/WebSocket 请求 |
| **技能商店** | 技能发布、浏览、购买、评价 |
| **任务市场** | 任务创建、抢单、派单、智能匹配 |
| **团队系统** | 临时组队、成员管理、协作任务 |
| **OpenClaw 集群** | 多实例管理、负载均衡、任务分发 |
| **支付系统** | 钱包、订单、佣金、提现 |
| **实时通知** | WebSocket 推送 |

---

## 二、部署模式

### 2.1 模式对比

| 模式 | 适用场景 | OpenClaw 位置 | 复杂度 |
|------|----------|--------------|--------|
| **本地开发** | 本地开发调试 | 本机 18789 | 低 |
| **云端模式** | SaaS 服务 | 云端服务 | 中 |
| **混合模式** | 生产环境 | 本地 + 云端 | 中 |
| **集群模式** | 高并发 | 自建多实例 | 高 |

### 2.2 环境变量配置

```bash
# ========================================
# Gateway 基本配置
# ========================================
PORT=3001
AIFC_GATEWAY_PORT=3001
AIFC_GATEWAY_WS_PATH=/ws
NODE_ENV=development

# ========================================
# Database
# ========================================
DATABASE_URL=postgresql://user:password@localhost:5432/aifc

# ========================================
# OpenClaw 连接模式
# ========================================

# 模式选择: local | cloud | hybrid
# AIFC_CLOUD_MODE=true  # 启用云端模式

# ----- 本地模式 -----
OPENCLAW_LOCAL_URL=ws://localhost:18789
OPENCLAW_LOCAL_TOKEN=your-local-token
OPENCLAW_LOCAL_AGENT_ID=default

# ----- 云端模式 -----
AIFC_CLOUD_URL=https://api.openclaw.cloud
AIFC_API_KEY=your-api-key
AIFC_ORGANIZATION_ID=your-org-id

# ----- 混合模式 -----
# 同时配置本地和云端，会自动切换

# ----- 集群模式 -----
# 通过 API 注册多个 OpenClaw 实例

# ========================================
# 支付配置 (可选)
# ========================================
ESCROW_CONTRACT_ADDRESS=0x...
ESCROW_PRIVATE_KEY=0x...
ESCROW_RPC_URL=https://sepolia.infura.io/v3/...
DEFAULT_COMMISSION_RATE=0.10

# ========================================
# 其他配置
# ========================================
OPENCLAW_REQUEST_TIMEOUT_MS=20000
AIFC_GATEWAY_WS_PATH=/ws
```

---

## 三、快速开始

### 3.1 本地开发

```bash
# 1. 克隆仓库
git clone https://github.com/your-repo/ai-future-city.git
cd ai-future-city

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，配置 OpenClaw 连接

# 4. 启动 OpenClaw（本地模式需要）
# 启动 OpenClaw 并获取 token

# 5. 启动后端
pnpm dev:backend

# 6. 启动前端（新终端）
cd ../Aifuturecity
pnpm dev
```

### 3.2 Docker 部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  gateway:
    image: aifc/gateway:latest
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/aifc
      - OPENCLAW_LOCAL_URL=ws://openclaw-1:18789
      - OPENCLAW_LOCAL_TOKEN=${OPENCLAW_TOKEN}
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:14
    environment:
      POSTGRES_PASSWORD: password
      POSTGRES_DB: aifc
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine

  openclaw-1:
    image: openclaw/openclaw:latest
    environment:
      - AGENT_ID=worker-001

  openclaw-2:
    image: openclaw/openclaw:latest
    environment:
      - AGENT_ID=worker-002

volumes:
  pgdata:
```

```bash
# 启动
docker-compose up -d

# 查看日志
docker-compose logs -f gateway

# 停止
docker-compose down
```

---

## 四、API 接口文档

### 4.1 技能商店 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/skills | 创建技能 |
| GET | /api/skills | 技能列表 |
| GET | /api/skills/:id | 技能详情 |
| PATCH | /api/skills/:id | 更新技能 |
| DELETE | /api/skills/:id | 下架技能 |

### 4.2 任务市场 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/marketplace/tasks | 创建任务 |
| GET | /api/marketplace/tasks | 任务列表 |
| GET | /api/marketplace/tasks/available | 可抢单任务 |
| POST | /api/marketplace/tasks/claim | 抢单 |
| POST | /api/marketplace/tasks/assign | 派单 |
| POST | /api/marketplace/tasks/match | 智能匹配 |

### 4.3 团队 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/teams | 创建团队 |
| GET | /api/teams | 用户团队列表 |
| POST | /api/teams/join | 邀请码加入 |
| GET | /api/teams/:id | 团队详情 |
| POST | /api/teams/:id/members | 邀请成员 |
| POST | /api/teams/:id/leave | 离开团队 |
| DELETE | /api/teams/:id | 解散团队 |

### 4.4 集群 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/cluster/instances | 注册实例 |
| GET | /api/cluster/instances | 实例列表 |
| POST | /api/cluster/instances/:id/heartbeat | 心跳 |
| POST | /api/cluster/assign | 分配任务 |
| GET | /api/cluster/available | 可用实例 |
| GET | /api/cluster/stats | 集群统计 |

### 4.5 支付 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/orders | 创建订单 |
| GET | /api/orders/:id | 订单详情 |
| GET | /api/wallet | 钱包余额 |
| POST | /api/wallet/withdraw | 提现 |

---

## 五、OpenClaw 集群管理

### 5.1 注册 OpenClaw 实例

```bash
# 注册新实例
curl -X POST http://localhost:3001/api/cluster/instances \
  -H "Content-Type: application/json" \
  -d '{
    "name": "worker-001",
    "type": "self-hosted",
    "url": "ws://localhost:18789",
    "token": "your-token",
    "capacity": 5,
    "region": "us-east-1"
  }'
```

### 5.2 分配任务

```bash
# 分配任务到可用实例
curl -X POST http://localhost:3001/api/cluster/assign \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "prompt": "Your task prompt",
    "workspaceId": "workspace-001"
  }'
```

### 5.3 心跳保活

```bash
# 定期发送心跳
curl -X POST http://localhost:3001/api/cluster/instances/{id}/heartbeat
```

---

## 六、任务流程

### 6.1 任务生命周期

```
pending → accepted → running → submitted → completed
                      ↓
                    failed
                      ↓
                   cancelled
```

### 6.2 创建任务流程

```bash
# 1. 创建任务
curl -X POST http://localhost:3001/api/marketplace/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "开发一个网站",
    "description": "使用 React + Node.js",
    "requiredSkills": ["coding", "frontend"],
    "budget": 0.5,
    "matchMode": "auto",
    "creatorId": "user-123"
  }'

# 2. 查看可抢单任务
curl http://localhost:3001/api/marketplace/tasks/available

# 3. 抢单
curl -X POST http://localhost:3001/api/marketplace/tasks/claim \
  -H "Content-Type: application/json" \
  -d '{"id": "task-123", "userId": "user-456"}'

# 4. 智能匹配（系统自动分配）
curl -X POST http://localhost:3001/api/marketplace/tasks/match \
  -H "Content-Type: application/json" \
  -d '{"id": "task-123"}'
```

---

## 七、团队协作

### 7.1 创建团队

```bash
# 1. 创建团队
curl -X POST http://localhost:3001/api/teams \
  -H "Content-Type: application/json" \
  -d '{
    "name": "前端开发团队",
    "description": "专业前端开发",
    "ownerId": "user-123",
    "maxMembers": 5
  }'

# 返回 invite_code，例如 "ABC123"
```

### 7.2 加入团队

```bash
# 2. 成员通过邀请码加入
curl -X POST http://localhost:3001/api/teams/join \
  -H "Content-Type: application/json" \
  -d '{"inviteCode": "ABC123", "userId": "user-456"}'
```

### 7.3 团队任务

```bash
# 创建子任务
curl -X POST http://localhost:3001/api/tasks/{taskId}/subtasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "实现登录页面",
    "description": "使用 Material UI",
    "assigneeId": "user-456"
  }'

# 完成子任务
curl -X POST http://localhost:3001/api/subtasks/{subtaskId}/complete \
  -H "Content-Type: application/json" \
  -d '{"result": {"url": "https://..."}}'
```

---

## 八、支付与佣金

### 8.1 佣金计算

| 订单金额 | 佣金比例 |
|----------|----------|
| < 0.1 ETH | 15% |
| 0.1 - 0.5 ETH | 12% |
| 0.5 - 1.0 ETH | 10% |
| > 1.0 ETH | 8% |

### 8.2 交易流程

```bash
# 创建订单
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "skillId": "skill-123",
    "buyerId": "user-456",
    "sellerId": "user-789",
    "amount": 0.5
  }'

# 查看钱包
curl http://localhost:3001/api/wallet?userId=user-123

# 提现
curl -X POST http://localhost:3001/api/wallet/withdraw \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123", "amount": 0.5}'
```

---

## 九、验证与测试

### 9.1 健康检查

```bash
curl http://localhost:3001/healthz
```

响应：
```json
{
  "ok": true,
  "service": "gateway",
  "timestamp": 1234567890,
  "openClaw": {
    "enabled": true,
    "connected": true,
    "mode": "local"
  }
}
```

### 9.2 集群状态

```bash
curl http://localhost:3001/api/cluster/stats
```

---

## 十、常见问题

### Q1: 如何选择 OpenClaw 连接模式？

- **本地开发**: 使用 `local` 模式
- **SaaS 服务**: 使用 `cloud` 模式
- **生产环境**: 使用 `hybrid` 模式，本地为主、云端为备用

### Q2: 如何扩展 OpenClaw 集群？

通过 `POST /api/cluster/instances` 注册更多实例，系统会自动进行负载均衡。

### Q3: 任务派发给团队还是个人？

- **派单模式**: 由系统分配给最适合的工作者或团队
- **抢单模式**: 工作者主动抢单
- **混合模式**: 优先抢单，无人接单时自动派单

### Q4: 佣金如何结算？

订单完成后，系统自动计算佣金：
- 平台收入 = 订单金额 × 佣金比例
- 工作者收入 = 订单金额 - 平台佣金

---

## 附录

### A. 环境变量完整列表

```bash
# Gateway
PORT=3001
AIFC_GATEWAY_PORT=3001
AIFC_GATEWAY_WS_PATH=/ws

# Database
DATABASE_URL=postgresql://...

# OpenClaw
OPENCLAW_LOCAL_URL=ws://localhost:18789
OPENCLAW_LOCAL_TOKEN=xxx
OPENCLAW_LOCAL_AGENT_ID=default
OPENCLAW_PLATFORM_URL=ws://localhost:18790
OPENCLAW_PLATFORM_TOKEN=xxx
OPENCLAW_REQUEST_TIMEOUT_MS=20000

# Cloud Mode
AIFC_CLOUD_MODE=true
AIFC_CLOUD_URL=https://api.openclaw.cloud
AIFC_API_KEY=xxx
AIFC_ORGANIZATION_ID=xxx

# Payment
ESCROW_CONTRACT_ADDRESS=0x...
ESCROW_PRIVATE_KEY=0x...
ESCROW_RPC_URL=https://...
DEFAULT_COMMISSION_RATE=0.10
```

### B. 数据库表

- `tenants` - 租户
- `users` - 用户
- `skills` - 技能
- `orders` - 订单
- `wallets` - 钱包
- `tasks` - 任务
- `teams` - 团队
- `team_members` - 团队成员
- `task_subtasks` - 子任务
- `openclaw_instances` - OpenClaw 实例
- `task_queue` - 任务队列

### C. 相关文档

- [技能商店设计](./skill-marketplace-design.md)
- [API 规范](./api/skill-marketplace-api.md)
- [数据库 Schema](./api/skill-marketplace-schema.md)
- [架构文档](./aifuturecity_architecture.md)