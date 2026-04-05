# 技能交易平台 - 架构与实现方案

## 概述

实现一个类似 Claw Mart 的中文版技能交易平台，支持：
- 任务接单与派发
- 智能匹配（分配最适合的 OpenClaw/团队）
- 技能交易
- 佣金收取

## 平台定位

**混合模式**：平台自营 AI 服务 + 团队自托管 OpenClaw + 任务撮合交易

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户端 (Web/App)                          │
│  技能市场 │ 任务大厅 │ 钱包中心 │ 开发者控制台                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway                              │
│  认证 │ 鉴权 │ 限流 │ 路由 (user → tenant)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  技能市场服务  │    │  任务调度服务  │    │  支付服务     │
│  - 技能 CRUD  │    │  - 任务发布   │    │  - 充值       │
│  - 技能搜索   │    │  - 智能派单   │    │  - 支付       │
│  - 评价系统   │    │  - 抢单/派单  │    │  - 佣金结算   │
└───────────────┘    │  - 匹配算法   │    │  - 提现       │
                      └───────────────┘    └───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw 集群管理                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  自营实例1  │  │  自营实例2  │  │ ...         │  (平台拥有)  │
│  └─────────────┘  └─────────────┘              │             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  团队A实例  │  │  团队B实例  │  │  团队C实例  │  (用户自托管) │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心概念

### 1. 租户 (Tenant)
- **团队** - 可以是一个公司、部门或个人
- 每个租户有独立的：
  - OpenClaw 配置（自托管或使用平台实例）
  - 技能库（发布的技能）
  - 钱包
  - 任务

### 2. OpenClaw 资源池

| 类型 | 描述 | 计费 |
|------|------|------|
| **平台实例** | 平台自营，按调用计费 | API 调用次数 |
| **团队实例** | 团队自托管，平台只管理连接 | 免费或固定费用 |
| **临时实例** | 任务需要时动态创建 | 按需计费 |

### 3. 任务流程

```
任务发布 → 智能匹配 → 派单/抢单 → 执行 → 验收 → 结算 → 评价
                              ↓
                       OpenClaw 实例分配
```

---

## API 端点

### 租户管理 (`/api/tenants`)

| 方法 | 端点 | 功能 |
|------|------|------|
| POST | `/api/tenants` | 创建租户 |
| GET | `/api/tenants` | 列出租户 |
| GET | `/api/tenants/:id` | 获取租户 |
| PATCH | `/api/tenants/:id` | 更新租户 |
| POST | `/api/tenants/:id/openclaw` | 配置 OpenClaw |
| GET | `/api/tenants/:id/openclaw` | 获取 OpenClaw 状态 |
| POST | `/api/tenants/:id/users` | 添加用户 |
| GET | `/api/tenants/:id/users` | 用户列表 |

### 技能市场 (`/api/skills`)

| 方法 | 端点 | 功能 |
|------|------|------|
| POST | `/api/skills` | 创建技能 |
| GET | `/api/skills` | 技能列表 |
| GET | `/api/skills/:id` | 技能详情 |
| PATCH | `/api/skills/:id` | 更新技能 |
| DELETE | `/api/skills/:id` | 下架技能 |

### 任务派发 (`/api/tasks`)

| 方法 | 端点 | 功能 |
|------|------|------|
| POST | `/api/tasks` | 创建任务 |
| GET | `/api/tasks` | 任务列表 |
| GET | `/api/tasks/available` | 抢单大厅 |
| POST | `/api/tasks/:id/claim` | 抢单 |
| POST | `/api/tasks/:id/assign` | 派单 |
| POST | `/api/tasks/:id/match` | 智能匹配 |
| PATCH | `/api/tasks/:id` | 更新状态 |

### 订单 (`/api/orders`)

| 方法 | 端点 | 功能 |
|------|------|------|
| POST | `/api/orders` | 创建订单 |
| GET | `/api/orders/:id` | 订单详情 |
| POST | `/api/orders/:id/pay` | 支付 |
| POST | `/api/orders/:id/complete` | 完成 |
| POST | `/api/orders/:id/cancel` | 取消 |

### 钱包 (`/api/wallet`)

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/api/wallet` | 余额查询 |
| POST | `/api/wallet/withdraw` | 提现 |
| GET | `/api/wallet/transactions` | 交易记录 |

### 支付 (`/api/payment`)

| 方法 | 端点 | 功能 |
|------|------|------|
| POST | `/api/payment/create-escrow` | 创建托管 |
| POST | `/api/payment/fund` | 充值到托管 |
| POST | `/api/payment/claim` | 申领里程碑 |
| POST | `/api/payment/release` | 释放里程碑 |

---

## 智能匹配算法

```typescript
interface MatchingCriteria {
  skill: string;        // 所需技能
  budget: number;       // 预算
  deadline: Date;       // 截止时间
  tenantRating: number; // 团队评分
  availability: boolean; // 可用性
}

// 匹配权重
const weights = {
  skillMatch: 0.4,     // 技能匹配度
  rating: 0.2,         // 评分
  price: 0.2,          // 价格合理
  availability: 0.1,   // 可用性
  history: 0.1,        // 历史合作
};
```

---

## 计费模式

| 场景 | 收费方式 |
|------|----------|
| 平台 OpenClaw 调用 | 按次 / 按 token |
| 技能购买 | 固定价格 + 平台佣金 |
| 任务委托 | 任务金额 + 平台服务费 |
| 团队自托管 | 免费 或 订阅费 |

**佣金比例示例**：
- 技能交易：卖家收 90%，平台收 10%
- 任务委托：平台收 5%

---

## 数据库表结构

详见 `backend/gateway/src/db/schema.sql`

### 核心表

- `tenants` - 租户/团队
- `users` - 用户
- `skills` - 技能
- `tasks` - 任务
- `orders` - 订单
- `reviews` - 评价
- `wallets` - 钱包
- `withdrawals` - 提现记录
- `payment_orders` - 支付订单
- `topup_orders` - 充值订单
- `platform_revenue` - 平台收入

---

## 使用方式

### 1. 初始化数据库

```bash
psql $DATABASE_URL -f backend/gateway/src/db/schema.sql
```

### 2. 启动服务

```bash
cd ai-future-city
pnpm dev:backend
```

### 3. API 示例

```bash
# 创建租户
curl -X POST http://localhost:3001/api/tenants \
  -H "Content-Type: application/json" \
  -d '{"name": "My Team", "type": "team"}'

# 配置 OpenClaw
curl -X POST http://localhost:3001/api/tenants/{tenant-id}/openclaw \
  -H "Content-Type: application/json" \
  -d '{"type": "self-hosted", "url": "ws://localhost:18789", "token": "xxx"}'

# 发布技能
curl -X POST http://localhost:3001/api/skills \
  -H "Content-Type: application/json" \
  -d '{"name": "网站开发", "description": "专业网站开发服务", "category": "dev", "pricing": {"type": "fixed", "amount": 1000}, "ownerId": "user-uuid"}'

# 发布任务
curl -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "开发一个电商网站", "requiredSkills": ["web-dev", "react"], "budget": 5000, "creatorId": "user-uuid"}'

# 抢单
curl -X POST http://localhost:3001/api/tasks/{task-id}/claim \
  -H "Content-Type: application/json" \
  -d '{"userId": "provider-uuid"}'
```

---

## 配置说明

### 环境变量

```bash
# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/aifuturecity

# OpenClaw 本地模式
OPENCLAW_LOCAL_URL=ws://localhost:18789
OPENCLAW_LOCAL_TOKEN=xxx

# OpenClaw 云端模式
AIFC_CLOUD_MODE=true
AIFC_CLOUD_URL=https://api.aifuturecity.com
AIFC_API_KEY=sk-xxx

# 支付（可选）
ESCROW_CONTRACT_ADDRESS=0x...
ESCROW_PRIVATE_KEY=0x...
ESCROW_RPC_URL=https://sepolia.infura.io/...
```