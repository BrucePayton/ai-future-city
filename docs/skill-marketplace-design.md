# 技能交易平台实现方案

> 类似 Claw Mart 的中文版技能交易平台，支持技能发布、交易、佣金收取、多币种支付

---

## 一、快速开始

### 1.1 环境要求

- Node.js 18+
- PostgreSQL 14+
- pnpm 10+

### 1.2 启动步骤

```bash
# 1. 克隆仓库并安装依赖
cd ai-future-city
pnpm install

# 2. 配置数据库
# 在 .env.local 中设置 DATABASE_URL
DATABASE_URL=postgresql://user:pass@localhost:5432/aifc

# 3. 初始化数据库表
psql $DATABASE_URL -f backend/gateway/src/db/schema.sql

# 4. 启动网关
pnpm dev:backend

# 5. 启动前端
cd ../Aifuturecity
pnpm dev

# 6. 访问技能商店
# http://localhost:5173/skill-store
```

### 1.3 可选配置（支付功能）

```bash
# .env.local
# 智能合约（可选）
ESCROW_CONTRACT_ADDRESS=0x...
ESCROW_PRIVATE_KEY=0x...
ESCROW_RPC_URL=https://sepolia.infura.io/v3/your-project-id

# 法币网关（可选）
SIMPLEX_SECRET=xxx
MOONPAY_SECRET=xxx

# 汇率 API（可选）
COINGECKO_API_KEY=xxx
```

---

## 一、现有能力分析

### 已具备

1. **Marketplace UI 前端页面** - `Aifuturecity/src/app/pages/Marketplace.tsx`
2. **任务数据模型（Mock）** - 任务浏览、筛选、发布功能
3. **钱包交易记录 Mock** - earned/cost/withdraw 交易类型
4. **Task Dispatch API** - `ai-future-city/backend/gateway/src/methods/tasks.ts`
5. **数据库 Schema** - PostgreSQL 表结构（含 users, assistants 等）
6. **智能合约占位符** - TaskEscrow.sol 等（空壳）

### 缺失

- 技能动态上架/商店 API
- 佣金计算和分成逻辑
- 支付/智能合约集成
- 完整用户认证系统

---

## 二、数据库选型建议

### 推荐方案：PostgreSQL + Redis + 向量存储（可选）

| 存储方案 | 用途 | 理由 |
|---------|------|------|
| **PostgreSQL** | 核心业务数据 | 项目已集成 pg，Drizzle ORM 支持好，适合事务性数据 |
| **Redis** | 缓存、会话、分布式锁 | 高并发场景必备，Pub/Sub 支持实时通知 |
| **pgvector (可选)** | 技能/任务语义搜索 | 如需技能相似度推荐，可在 PG 中扩展 |

### 不推荐

| 方案 | 理由 |
|------|------|
| MySQL | 项目已是 PG，技术栈统一 |
| Elasticsearch | 技能搜索量级目前不需要，PG LIKE/全文搜索足够 |
| MongoDB | 无事务需求，PG 足够 |

### 当前项目已具备

- PostgreSQL 驱动：`pg` ^8.13.0
- 数据库 Schema：`ai-future-city/backend/gateway/src/db/schema.sql`
- Drizzle ORM 集成（架构文档中提到）

---

## 三、核心数据模型设计

### 新增数据库表

```sql
-- 1. 技能/服务（Skill）
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,              -- 技能名称
  description TEXT,               -- 技能描述
  category TEXT NOT NULL,         -- 分类：software-engineer, data-analyst 等
  pricing JSONB NOT NULL DEFAULT '{}',  -- 价格策略
  -- pricing 示例: { "type": "fixed", "amount": 0.05, "currency": "ETH" }
  -- 或: { "type": "hourly", "rate": 0.01, "minHours": 1 }
  commission_rate DECIMAL(5,4) DEFAULT 0.10,  -- 佣金比例，默认 10%
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  stats JSONB DEFAULT '{}',       -- 销量、评分等统计
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 技能订单（Order）
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES skills(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  amount DECIMAL(20,8) NOT NULL,  -- 订单金额
  commission DECIMAL(20,8) NOT NULL,  -- 平台佣金
  net_amount DECIMAL(20,8) NOT NULL,  -- 卖家净收入
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','paid','completed','cancelled','refunded')),
  milestone_id UUID,              -- 如果是里程碑模式，关联里程碑
  tx_hash TEXT,                   -- 区块链交易哈希
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 技能评价（Review）
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  reviewee_id UUID NOT NULL REFERENCES users(id),
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 卖家收入钱包（Wallet）
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
  balance DECIMAL(20,8) DEFAULT 0,
  pending_balance DECIMAL(20,8) DEFAULT 0,  -- 待结算
  total_earned DECIMAL(20,8) DEFAULT 0,
  total_withdrawn DECIMAL(20,8) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 提现记录（Withdrawal）
CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount DECIMAL(20,8) NOT NULL,
  fee DECIMAL(20,8) DEFAULT 0,    -- 提现手续费
  net_amount DECIMAL(20,8) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- 6. 平台收入（Platform Revenue）
CREATE TABLE platform_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  amount DECIMAL(20,8) NOT NULL,
  type TEXT,  -- 'commission', 'withdrawal_fee', 'listing_fee'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 四、核心 API 设计

### 技能模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/skills | 创建技能 |
| GET | /api/skills | 列表（支持分类、搜索、排序） |
| GET | /api/skills/:id | 详情 |
| PUT | /api/skills/:id | 更新 |
| DELETE | /api/skills/:id | 下架 |

### 订单模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/orders | 创建订单 |
| GET | /api/orders/:id | 订单详情 |
| POST | /api/orders/:id/pay | 支付订单 |
| POST | /api/orders/:id/complete | 确认完成 |
| POST | /api/orders/:id/cancel | 取消订单 |

### 钱包模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/wallet | 钱包余额 |
| GET | /api/wallet/transactions | 交易历史 |
| POST | /api/wallet/withdraw | 申请提现 |

### 佣金计算

```typescript
// 佣金计算逻辑
function calculateCommission(amount: number, rate: number = 0.10) {
  const commission = amount * rate;
  const netAmount = amount - commission;
  return { commission, netAmount };
}

// 阶梯佣金（可选）
function getTieredCommission(amount: number): number {
  if (amount < 0.1) return 0.15;  // < 0.1 ETH: 15%
  if (amount < 0.5) return 0.12; // 0.1-0.5 ETH: 12%
  if (amount < 1.0) return 0.10; // 0.5-1.0 ETH: 10%
  return 0.08;                   // > 1.0 ETH: 8%
}
```

---

## 五、实现步骤

### Phase 1: 数据模型与基础 API
1. 扩展数据库 schema（skills, orders, wallets 表）
2. 实现技能 CRUD API
3. 实现订单创建与状态流转

### Phase 2: 佣金与钱包
1. 佣金计算逻辑
2. 钱包余额管理
3. 提现功能

### Phase 3: 支付集成
1. 智能合约集成（托管/解锁）
2. 支付回调处理
3. 区块链交易记录

### Phase 4: 前端对接
1. 技能商店页面
2. 订单管理页面
3. 钱包页面

---

## 六、关键技术点

### 1. 事务处理
使用 PostgreSQL 事务确保订单创建与余额扣减的原子性：

```typescript
await pg.transaction(async (tx) => {
  // 扣减买家余额
  await tx`UPDATE wallets SET balance = balance - ${amount} WHERE user_id = ${buyerId}`;
  // 冻结金额到 pending
  await tx`UPDATE wallets SET pending_balance = pending_balance + ${amount} WHERE user_id = ${sellerId}`;
  // 创建订单
  await tx`INSERT INTO orders ...`;
});
```

### 2. 幂等性
订单创建使用唯一约束防止重复提交：

```typescript
// 通过 idempotency_key 确保幂等
CREATE TABLE orders (
  idempotency_key TEXT UNIQUE,
  ...
);
```

### 3. 异步结算
使用消息队列（如 Redis Pub/Sub）处理支付回调：

```typescript
// 支付成功后异步结算
await redis.publish('order:paid', JSON.stringify({ orderId, txHash }));
```

---

## 七、现有可复用代码

| 组件 | 路径 | 说明 |
|------|------|------|
| DB Client | `backend/gateway/src/db/client.ts` | PostgreSQL 连接 |
| Schema | `backend/gateway/src/db/schema.sql` | 现有表结构 |
| Method Router | `backend/gateway/src/server/method-router.ts` | HTTP 路由注册 |
| Tasks API | `backend/gateway/src/methods/tasks.ts` | 任务分发参考 |
| Mock Data | `Aifuturecity/src/app/data/mockData.ts` | 前端数据模型 |

---

## 八、文件结构

建议新增文件：

```
ai-future-city/
├── backend/gateway/
│   ├── src/
│   │   ├── methods/
│   │   │   ├── skills.ts        # 技能 API
│   │   │   ├── orders.ts        # 订单 API
│   │   │   ├── wallet.ts        # 钱包 API
│   │   │   └── commission.ts    # 佣金计算
│   │   ├── db/
│   │   │   └── schema.sql        # 扩展 schema
│   │   └── services/
│   │       ├── payment-service.ts   # 支付服务
│   │       └── escrow-service.ts    # 托管服务
│   └── package.json              # 添加依赖
├── Aifuturecity/
│   └── src/app/
│       ├── pages/
│       │   ├── SkillStore.tsx   # 技能商店
│       │   ├── MySkills.tsx     # 我的技能
│       │   ├── OrderList.tsx   # 订单列表
│       │   └── Wallet.tsx       # 钱包（扩展）
│       └── api/
│           ├── skills.ts        # 技能 API 调用
│           ├── orders.ts        # 订单 API 调用
│           └── wallet.ts        # 钱包 API 调用
└── docs/
    ├── skill-marketplace-design.md    # 本文档
    └── api/skill-marketplace-api.md   # API 详细规范
```

---

## 九、总结

### 需要的技术栈

| 类别 | 选型 |
|------|------|
| 主数据库 | PostgreSQL（已有） |
| 缓存/消息 | Redis（建议新增） |
| 向量搜索 | pgvector（可选，未来需要时） |
| ORM | Drizzle（架构文档推荐） |
| 智能合约 | Hardhat + OpenZeppelin（已有占位） |

### 开发工作量估算

| 模块 | 工作量 |
|------|--------|
| 数据模型 | 2-3 天 |
| 技能 API | 3-5 天 |
| 订单/钱包 | 3-5 天 |
| 支付集成 | 5-7 天 |
| 前端页面 | 5-7 天 |
| **总计** | **18-27 天** |

---

## 十、API 完整文档

### 环境变量配置

在 `.env.local` 或环境变量中配置：

```bash
# 数据库（已有）
DATABASE_URL=postgresql://user:pass@localhost:5432/aifc

# 支付服务（可选）
ESCROW_CONTRACT_ADDRESS=0x...
ESCROW_PRIVATE_KEY=0x...
ESCROW_RPC_URL=https://sepolia.infura.io/v3/your-project-id

# 佣金设置（可选，默认 10%）
DEFAULT_COMMISSION_RATE=0.10
```

### HTTP API 端点

#### Skills API (技能管理)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/skills | 创建技能 |
| GET | /api/skills | 技能列表（支持 category, status, ownerId, search, sortBy, limit, offset） |
| GET | /api/skills/:id | 技能详情 |
| PATCH | /api/skills/:id | 更新技能 |
| DELETE | /api/skills/:id | 下架技能（状态设为 archived） |

**请求示例 - 创建技能：**
```bash
curl -X POST http://localhost:3001/api/skills \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Python 数据分析专家",
    "description": "专业的数据分析服务",
    "category": "data-analyst",
    "pricing": {"type": "fixed", "amount": 0.1},
    "tags": ["Python", "数据分析"],
    "ownerId": "user-001"
  }'
```

#### Orders API (订单管理)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/orders | 创建订单（支持 idempotencyKey 防重放） |
| GET | /api/orders/:id | 订单详情 |
| POST | /api/orders/:id/pay | 支付订单 |
| POST | /api/orders/:id/complete | 确认完成 |
| POST | /api/orders/:id/cancel | 取消订单 |

#### Wallet API (钱包管理)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/wallet?userId=xxx | 获取钱包余额 |
| POST | /api/wallet/withdraw | 申请提现 |

#### Reviews API (评价管理)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/reviews | 创建评价 |
| GET | /api/reviews?skillId=xxx | 获取技能评价 |

#### Payment API (支付集成)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/payment/status | 支付服务状态 |
| POST | /api/payment/escrow | 创建托管订单 |
| POST | /api/payment/fund | 充值到托管 |
| POST | /api/payment/claim | 申领里程碑 |
| POST | /api/payment/release | 释放里程碑 |
| GET | /api/payment/escrow/:id | 托管状态查询 |

### 佣金计算规则

阶梯佣金（根据订单金额）：

| 金额范围 | 佣金比例 |
|---------|---------|
| < 0.1 ETH | 15% |
| 0.1 - 0.5 ETH | 12% |
| 0.5 - 1.0 ETH | 10% |
| > 1.0 ETH | 8% |

卖家净收入 = 订单金额 - 佣金

### 提现规则

- 手续费：1%
- 净到账 = 提现金额 - 手续费

---

## 十一、前端集成

### 路由

技能商店页面：`/skill-store`

### API 客户端

文件：`Aifuturecity/src/app/api/skill-marketplace.ts`

```typescript
import { skillMarketplaceApi } from './api/skill-marketplace';

// 获取技能列表
const skills = await skillMarketplaceApi.listSkills({
  category: 'software-engineer',
  search: 'Python',
  sortBy: 'salesCount'
});

// 创建订单
const order = await skillMarketplaceApi.createOrder({
  skillId: 'skill-xxx',
  buyerId: 'user-001',
  sellerId: 'user-002',
  amount: 0.1
});

// 获取钱包
const wallet = await skillMarketplaceApi.getWallet('user-001');
```

---

## 十二、智能合约

### 部署

1. 编译合约：
```bash
cd contracts
npx hardhat compile
```

2. 部署到测试网：
```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

3. 配置环境变量：
```bash
ESCROW_CONTRACT_ADDRESS=0x...  # 部署返回的地址
```

### 合约功能

- `createEscrow()` - 创建托管订单
- `fund()` - 充值（ETH）
- `fundWithToken()` - 充值（ERC20）
- `claimMilestone()` - 卖家申领里程碑
- `releaseMilestone()` - 平台释放资金
- `cancelOrder()` - 取消并退款

---

## 十三、数据库初始化

运行 schema 脚本创建新表：

```bash
psql $DATABASE_URL -f backend/gateway/src/db/schema.sql
```

或通过代码自动初始化（如果 gateway 使用 PostgreSQL）：
```typescript
// 在 gateway 启动时自动创建
const pool = createPgPool(env.databaseUrl);
await initSchema(pool);
```

---

## 十四、状态流转图

```
技能状态：draft -> published -> archived

订单状态：
  pending -> paid -> completed
       |        +-> cancelled
       +-> refunded

提现状态：
  pending -> processing -> completed
                      +-> rejected/failed
```

---

## 十五、多币种支付网关

### 支持的支付方式

#### 加密货币
| 方式 | 货币 | 手续费 | 最小/最大 |
|------|------|--------|------------|
| ETH | ETH | 0.1% 网络费 | 0.001 - 1000 |
| BTC | BTC | 0.0001 BTC | 0.0001 - 100 |
| USDT | USDT (ERC20) | 1 USDT 固定 | 10 - 100000 |

#### 法币支付
| 方式 | 货币 | 手续费 | 最小/最大 |
|------|------|--------|------------|
| 支付宝 | CNY | 2.9% | 10 - 50000 |
| 微信支付 | CNY | 2.9% | 10 - 50000 |
| 银行卡 | CNY/USD | 2.5% | 10 - 100000 |
| 余额支付 | 全部 | 0 | 0.01 - 1000000 |

### 汇率支持

支持实时汇率转换（基于 CoinGecko API）：
- ETH → USD, CNY
- BTC → USD, CNY
- USDT → USD, CNY
- BNB → USD, CNY
- CNY ↔ USD

### 支付流程

1. **创建支付订单**
   ```bash
   POST /api/payment/create
   {
     "userId": "user-001",
     "amount": 100,
     "currency": "USDT",
     "paymentMethod": "usdt",
     "productId": "skill-001",
     "productName": "Python 数据分析"
   }
   ```

2. **加密货币支付**
   - 返回充值地址
   - 用户转账后调用 `processCryptoPayment` 确认

3. **法币支付**
   - 返回支付网关跳转链接
   - 第三方回调确认

4. **余额支付**
   - 直接扣减余额
   - 即时到账

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/payment/methods | 获取支付方式列表 |
| GET | /api/payment/rates | 获取汇率 |
| POST | /api/payment/create | 创建支付订单 |
| POST | /api/payment/crypto/callback | 加密货币支付回调 |
| POST | /api/payment/fiat/callback | 法币支付回调 |
| POST | /api/topup/create | 创建充值订单 |
| POST | /api/topup/confirm | 确认充值到账 |
| POST | /api/withdraw/create | 创建提现请求 |
| POST | /api/withdraw/confirm | 确认提现 |

### 第三方集成（可选）

- **加密货币**: 集成 Binance API, OKX API 进行自动兑换
- **法币支付**: Simplex, MoonPay, Mercuryo, Alchemy Pay, 币易支付
- **汇率**: CoinGecko, CoinMarketCap

### 环境变量

```bash
# 支付网关配置
SIMPLEX_SECRET=xxx
MOONPAY_SECRET=xxx
ALCHEMY_PAY_KEY=xxx

# 加密货币交易所
BINANCE_API_KEY=xxx
BINANCE_SECRET=xxx
OKX_API_KEY=xxx
OKX_SECRET=xxx

# 汇率 API
COINGECKO_API_KEY=xxx
```