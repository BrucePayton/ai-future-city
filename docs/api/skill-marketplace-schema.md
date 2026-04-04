# 技能交易平台数据库 Schema

本文档描述技能交易平台所需的数据库表结构。

---

## 一、核心业务表

### 1.1 skills - 技能/服务表

```sql
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  owner_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  pricing JSONB NOT NULL DEFAULT '{}',
  commission_rate DECIMAL(5,4) DEFAULT 0.10,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  stats JSONB DEFAULT '{"viewCount": 0, "salesCount": 0, "avgRating": 0, "totalEarnings": 0}',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_skills_tenant_id ON skills(tenant_id);
CREATE INDEX idx_skills_owner_id ON skills(owner_id);
CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_status ON skills(status);
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant_id | UUID | 租户 ID（多租户支持） |
| owner_id | UUID | 技能所有者（卖家） |
| name | TEXT | 技能名称 |
| description | TEXT | 技能描述 |
| category | TEXT | 分类 |
| pricing | JSONB | 定价策略 |
| commission_rate | DECIMAL(5,4) | 佣金比例 |
| status | TEXT | 状态：draft/published/archived |
| stats | JSONB | 统计数据 |
| tags | TEXT[] | 标签数组 |

**pricing JSON 结构：**
```json
{
  "type": "fixed",
  "amount": 0.1,
  "currency": "ETH"
}
```

---

### 1.2 orders - 订单表

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  idempotency_key TEXT UNIQUE,
  skill_id UUID NOT NULL REFERENCES skills(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  amount DECIMAL(20,8) NOT NULL,
  commission DECIMAL(20,8) NOT NULL,
  net_amount DECIMAL(20,8) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','completed','cancelled','refunded')),
  milestone_id UUID,
  tx_hash TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX orders_tenant_id ON orders(tenant_id);
CREATE INDEX orders_skill_id ON orders(skill_id);
CREATE INDEX orders_buyer_id ON orders(buyer_id);
CREATE INDEX orders_seller_id ON orders(seller_id);
CREATE INDEX orders_status ON orders(status);
```

---

### 1.3 reviews - 评价表

```sql
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  order_id UUID NOT NULL REFERENCES orders(id),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  reviewee_id UUID NOT NULL REFERENCES users(id),
  skill_id UUID REFERENCES skills(id),
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX reviews_tenant_id ON reviews(tenant_id);
CREATE INDEX reviews_order_id ON reviews(order_id);
CREATE INDEX reviews_reviewee_id ON reviews(reviewee_id);
CREATE INDEX reviews_skill_id ON reviews(skill_id);
```

---

### 1.4 wallets - 钱包表

```sql
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
  balance DECIMAL(20,8) DEFAULT 0,
  pending_balance DECIMAL(20,8) DEFAULT 0,
  total_earned DECIMAL(20,8) DEFAULT 0,
  total_withdrawn DECIMAL(20,8) DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX wallets_user_id ON wallets(user_id);
CREATE INDEX wallets_tenant_id ON wallets(tenant_id);
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| balance | 可用余额 |
| pending_balance | 冻结金额（待结算） |
| total_earned | 累计收入 |
| total_withdrawn | 累计提现 |

---

### 1.5 withdrawals - 提现记录表

```sql
CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount DECIMAL(20,8) NOT NULL,
  fee DECIMAL(20,8) DEFAULT 0,
  net_amount DECIMAL(20,8) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  tx_hash TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX withdrawals_wallet_id ON withdrawals(wallet_id);
CREATE INDEX withdrawals_status ON withdrawals(status);
CREATE INDEX withdrawals_tenant_id ON withdrawals(tenant_id);
```

---

### 1.6 platform_revenue - 平台收入表

```sql
CREATE TABLE platform_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  order_id UUID REFERENCES orders(id),
  withdrawal_id UUID REFERENCES withdrawals(id),
  amount DECIMAL(20,8) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('commission','withdrawal_fee','listing_fee','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX platform_revenue_tenant_id ON platform_revenue(tenant_id);
CREATE INDEX platform_revenue_type ON platform_revenue(type);
```

---

## 二、支付网关表

### 2.1 payment_orders - 支付订单表

```sql
CREATE TABLE payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  user_id UUID NOT NULL REFERENCES users(id),
  order_no TEXT NOT NULL UNIQUE,
  amount DECIMAL(20,8) NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('ETH','BTC','USDT','USDC','BNB','CNY','USD')),
  payment_method TEXT NOT NULL,
  usd_amount DECIMAL(20,8) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  tx_hash TEXT,
  fiat_provider TEXT,
  fiat_order_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX payment_orders_order_no ON payment_orders(order_no);
CREATE INDEX payment_orders_status ON payment_orders(status);
CREATE INDEX payment_orders_expires_at ON payment_orders(expires_at);
```

---

### 2.2 topup_orders - 充值订单表

```sql
CREATE TABLE topup_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  user_id UUID NOT NULL REFERENCES users(id),
  amount DECIMAL(20,8) NOT NULL,
  currency TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  wallet_address TEXT,
  tx_hash TEXT,
  confirmed_amount DECIMAL(20,8),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX topup_orders_user_id ON topup_orders(user_id);
CREATE INDEX topup_orders_status ON topup_orders(status);
```

---

### 2.3 withdraw_orders - 提现订单表

```sql
CREATE TABLE withdraw_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  user_id UUID NOT NULL REFERENCES users(id),
  amount DECIMAL(20,8) NOT NULL,
  fee DECIMAL(20,8) NOT NULL,
  net_amount DECIMAL(20,8) NOT NULL,
  currency TEXT NOT NULL,
  to_address TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('crypto','bank')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','rejected','failed')),
  tx_hash TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX withdraw_orders_user_id ON withdraw_orders(user_id);
CREATE INDEX withdraw_orders_status ON withdraw_orders(status);
```

---

### 2.4 exchange_rates - 汇率缓存表

```sql
CREATE TABLE exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency TEXT NOT NULL UNIQUE,
  usd_rate DECIMAL(20,8) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 2.5 payment_methods - 支付方式配置表

```sql
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('crypto','fiat','balance')),
  name TEXT NOT NULL,
  icon TEXT,
  fee DECIMAL(10,4) NOT NULL DEFAULT 0,
  min_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
  max_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB DEFAULT '{}'
);
```

---

## 三、ER 关系图

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    users    │     │   skills    │     │   orders    │
├─────────────┤     ├─────────────┤     ├─────────────┤
│ id (PK)     │◄────│ owner_id    │     │ id (PK)     │
│             │     │             │     │ skill_id    │──┐
└─────────────┘     └─────────────┘     │ buyer_id    │──┼──┐
                                       │ seller_id   │  │  │
                              ┌─────────│─────────────│  │  │
                              │         └─────────────┘  │  │
                              │                          │  │
                              ▼                          ▼  ▼
                        ┌─────────────┐     ┌─────────────┐
                        │   reviews   │     │  wallets   │
                        ├─────────────┤     ├─────────────┤
                        │ id (PK)     │     │ id (PK)    │
                        │ order_id    │     │ user_id    │──┐
                        │ reviewer_id │     │             │  │
                        │ reviewee_id │     └─────────────┘  │
                        │ skill_id    │                    │
                        └─────────────┘                    │
                                                         │
                        ┌─────────────┐                  │
                        │ payment_    │                  │
                        │ orders      │                  │
                        ├─────────────┤                  │
                        │ id (PK)     │                  │
                        │ user_id     │◄─────────────────┘
                        │ order_no    │
                        └─────────────┘
```

---

## 四、初始化脚本

### 插入默认支付方式

```sql
INSERT INTO payment_methods (id, type, name, icon, fee, min_amount, max_amount) VALUES
('eth', 'crypto', 'ETH', 'Ethereum', 0.001, 0.001, 1000),
('btc', 'crypto', 'BTC', 'Bitcoin', 0.0001, 0.0001, 100),
('usdt', 'crypto', 'USDT', 'Tether', 1, 10, 100000),
('alipay', 'fiat', '支付宝', 'Alipay', 0.029, 10, 50000),
('wechat', 'fiat', '微信支付', 'WeChat', 0.029, 10, 50000),
('bank_card', 'fiat', '银行卡', 'CreditCard', 0.025, 10, 100000),
('balance', 'balance', '余额支付', 'Wallet', 0, 0.01, 1000000)
ON CONFLICT (id) DO NOTHING;
```

---

## 五、迁移指南

### 从现有数据库迁移

如果已有旧版 schema，按以下顺序迁移：

1. **备份数据**
2. **创建新表**（使用 `IF NOT EXISTS`）
3. **迁移数据**
4. **验证数据完整性**
5. **更新应用代码**

### 完整 SQL

```bash
# 初始化数据库
psql $DATABASE_URL -f backend/gateway/src/db/schema.sql

# 验证表创建成功
psql $DATABASE_URL -c "\dt"
```