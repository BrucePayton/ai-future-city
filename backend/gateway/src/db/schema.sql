-- AIFutureCity Gateway - PostgreSQL Schema (multi-tenant)
-- Run: psql $DATABASE_URL -f src/db/schema.sql
-- Idempotent: safe to run multiple times.

-- Default tenant UUID used when tenant_id is not yet resolved (Phase 1 single-tenant)
-- Must match ensureDefaultTenant() in client.ts
-- a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11

-- 1) Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(slug)
);

-- 2) Default tenant (Phase 1 single-tenant)
INSERT INTO tenants (id, name, slug, created_at, updated_at)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'Default',
  'default',
  NOW(),
  NOW()
)
ON CONFLICT (slug) DO NOTHING;

-- 3) Users (optional, for Phase 2)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);

-- 4) Workspace sessions (replaces in-memory SessionStore)
CREATE TABLE IF NOT EXISTS workspace_sessions (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','idle')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_sessions_tenant_id ON workspace_sessions(tenant_id);

-- 5) Training progress (replaces in-memory TrainingProgressStore)
CREATE TABLE IF NOT EXISTS training_progress (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assistant_id TEXT NOT NULL,
  chat JSONB NOT NULL DEFAULT '{}',
  exec JSONB NOT NULL DEFAULT '{}',
  task JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, assistant_id)
);

-- 6) Training sessions (replaces in-memory TrainingSessionStore)
CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assistant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  progress JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_tenant_id ON training_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_sessions_assistant_id ON training_sessions(assistant_id);

-- 7) Assistants: add tenant_id to existing tables (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assistants_devices' AND column_name = 'tenant_id') THEN
    ALTER TABLE assistants_devices ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    ALTER TABLE assistants_devices DROP CONSTRAINT IF EXISTS assistants_devices_pkey;
    ALTER TABLE assistants_devices ADD PRIMARY KEY (tenant_id, id);
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    CREATE TABLE assistants_devices (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'pc' CHECK (kind IN ('openclaw','sdk','pc','custom')),
      status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline')),
      last_seen_at BIGINT NOT NULL DEFAULT 0,
      name TEXT,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, id)
    );
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assistants_devices') THEN
    CREATE TABLE assistants_devices (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'pc' CHECK (kind IN ('openclaw','sdk','pc','custom')),
      status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline')),
      last_seen_at BIGINT NOT NULL DEFAULT 0,
      name TEXT,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, id)
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assistant_configs' AND column_name = 'tenant_id') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assistant_configs') THEN
      ALTER TABLE assistant_configs ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    END IF;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assistant_configs') THEN
    CREATE TABLE assistant_configs (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      persona JSONB NOT NULL DEFAULT '{}',
      tools JSONB NOT NULL DEFAULT '[]',
      constraints JSONB NOT NULL DEFAULT '[]',
      cost_control JSONB NOT NULL DEFAULT '{}',
      chat_evaluate_pass_threshold INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, id)
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assistant_hidden_ids') THEN
    CREATE TABLE assistant_hidden_ids (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      id TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assistant_hidden_ids' AND column_name = 'tenant_id') THEN
    ALTER TABLE assistant_hidden_ids ADD COLUMN tenant_id UUID NOT NULL DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' REFERENCES tenants(id) ON DELETE CASCADE;
    ALTER TABLE assistant_hidden_ids DROP CONSTRAINT IF EXISTS assistant_hidden_ids_pkey;
    ALTER TABLE assistant_hidden_ids ADD PRIMARY KEY (tenant_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assistant_delisted_ids') THEN
    CREATE TABLE assistant_delisted_ids (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      id TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assistant_delisted_ids' AND column_name = 'tenant_id') THEN
    ALTER TABLE assistant_delisted_ids ADD COLUMN tenant_id UUID NOT NULL DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' REFERENCES tenants(id) ON DELETE CASCADE;
    ALTER TABLE assistant_delisted_ids DROP CONSTRAINT IF EXISTS assistant_delisted_ids_pkey;
    ALTER TABLE assistant_delisted_ids ADD PRIMARY KEY (tenant_id, id);
  END IF;
END $$;

-- ============================================================
-- Skill Marketplace Tables (技能交易平台)
-- ============================================================

-- 8) Skills / Services (技能/服务)
CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  pricing JSONB NOT NULL DEFAULT '{}',
  commission_rate DECIMAL(5,4) DEFAULT 0.10,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  stats JSONB DEFAULT '{"viewCount": 0, "salesCount": 0, "avgRating": 0}',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_tenant_id ON skills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_skills_owner_id ON skills(owner_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);

-- 9) Orders (订单)
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
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

CREATE INDEX IF NOT EXISTS orders_tenant_id ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS orders_skill_id ON orders(skill_id);
CREATE INDEX IF NOT EXISTS orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS orders_seller_id ON orders(seller_id);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);

-- 10) Reviews (评价)
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  order_id UUID NOT NULL REFERENCES orders(id),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  reviewee_id UUID NOT NULL REFERENCES users(id),
  skill_id UUID REFERENCES skills(id),
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reviews_tenant_id ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS reviews_order_id ON reviews(order_id);
CREATE INDEX IF NOT EXISTS reviews_reviewee_id ON reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS reviews_skill_id ON reviews(skill_id);

-- 11) Wallets (钱包)
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  balance DECIMAL(20,8) DEFAULT 0,
  pending_balance DECIMAL(20,8) DEFAULT 0,
  total_earned DECIMAL(20,8) DEFAULT 0,
  total_withdrawn DECIMAL(20,8) DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS wallets_tenant_id ON wallets(tenant_id);

-- 12) Withdrawals (提现记录)
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
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

CREATE INDEX IF NOT EXISTS withdrawals_wallet_id ON withdrawals(wallet_id);
CREATE INDEX IF NOT EXISTS withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS withdrawals_tenant_id ON withdrawals(tenant_id);

-- 13) Platform Revenue (平台收入)
CREATE TABLE IF NOT EXISTS platform_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  order_id UUID REFERENCES orders(id),
  withdrawal_id UUID REFERENCES withdrawals(id),
  amount DECIMAL(20,8) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('commission','withdrawal_fee','listing_fee','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_revenue_tenant_id ON platform_revenue(tenant_id);
CREATE INDEX IF NOT EXISTS platform_revenue_type ON platform_revenue(type);

-- ============================================================
-- Payment Gateway Tables (多币种支付)
-- ============================================================

-- 14) Payment Orders (支付订单)
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
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

CREATE INDEX IF NOT EXISTS payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS payment_orders_order_no ON payment_orders(order_no);
CREATE INDEX IF NOT EXISTS payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS payment_orders_expires_at ON payment_orders(expires_at);

-- 15) Top-up Orders (充值订单)
CREATE TABLE IF NOT EXISTS topup_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
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

CREATE INDEX IF NOT EXISTS topup_orders_user_id ON topup_orders(user_id);
CREATE INDEX IF NOT EXISTS topup_orders_status ON topup_orders(status);

-- 16) Withdraw Orders (提现订单)
CREATE TABLE IF NOT EXISTS withdraw_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
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

CREATE INDEX IF NOT EXISTS withdraw_orders_user_id ON withdraw_orders(user_id);
CREATE INDEX IF NOT EXISTS withdraw_orders_status ON withdraw_orders(status);

-- 17) Exchange Rates (汇率缓存)
CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency TEXT NOT NULL UNIQUE,
  usd_rate DECIMAL(20,8) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18) Payment Methods Config (支付方式配置)
CREATE TABLE IF NOT EXISTS payment_methods (
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
