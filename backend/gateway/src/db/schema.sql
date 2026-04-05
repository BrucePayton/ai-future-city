-- Skill Trading Platform Database Schema
-- Multi-tenant architecture with tenant isolation

-- 1) Tenants (租户/团队)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  type TEXT NOT NULL DEFAULT 'individual' CHECK (type IN ('individual', 'team', 'enterprise')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  openclaw_config JSONB,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS tenants_status ON tenants(status);

-- 2) Users (用户) - can belong to multiple tenants
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  display_name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_external_id ON users(external_id);

-- 3) Tenant Users (租户成员关联)
CREATE TABLE IF NOT EXISTS tenant_users (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  display_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

-- 4) Skills (技能/服务)
CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  pricing JSONB NOT NULL DEFAULT '{"type":"fixed"}',
  commission_rate DECIMAL(5,2) DEFAULT 10.00,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  view_count INT DEFAULT 0,
  sales_count INT DEFAULT 0,
  avg_rating DECIMAL(3,2) DEFAULT 0.00,
  total_earnings DECIMAL(20,8) DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS skills_tenant_id ON skills(tenant_id);
CREATE INDEX IF NOT EXISTS skills_owner_id ON skills(owner_id);
CREATE INDEX IF NOT EXISTS skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS skills_status ON skills(status);

-- 5) Reviews (评价)
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID REFERENCES skills(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  reviewer_id UUID REFERENCES users(id),
  reviewee_id UUID REFERENCES users(id),
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reviews_skill_id ON reviews(skill_id);
CREATE INDEX IF NOT EXISTS reviews_reviewer_id ON reviews(reviewer_id);

-- 6) Orders (订单)
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID REFERENCES skills(id),
  buyer_id UUID REFERENCES users(id),
  seller_id UUID REFERENCES users(id),
  amount DECIMAL(20,8) NOT NULL,
  commission DECIMAL(20,8) DEFAULT 0,
  net_amount DECIMAL(20,8) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'completed', 'cancelled', 'refunded')),
  tx_hash TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS orders_skill_id ON orders(skill_id);
CREATE INDEX IF NOT EXISTS orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS orders_seller_id ON orders(seller_id);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);

-- 7) Wallets (钱包)
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  balance DECIMAL(20,8) DEFAULT 0,
  frozen DECIMAL(20,8) DEFAULT 0,
  total_earned DECIMAL(20,8) DEFAULT 0,
  total_withdrawn DECIMAL(20,8) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS wallets_tenant_id ON wallets(tenant_id);
CREATE INDEX IF NOT EXISTS wallets_user_id ON wallets(user_id);

-- 8) Transactions (交易记录)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  amount DECIMAL(20,8) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'payment', 'commission', 'refund', 'freeze', 'unfreeze')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  tx_hash TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS transactions_order_id ON transactions(order_id);
CREATE INDEX IF NOT EXISTS transactions_type ON transactions(type);

-- 9) Withdrawals (提现)
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  fee DECIMAL(20,8) DEFAULT 0,
  net_amount DECIMAL(20,8) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('crypto', 'bank', 'balance')),
  to_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  tx_hash TEXT,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS withdrawals_wallet_id ON withdrawals(wallet_id);
CREATE INDEX IF NOT EXISTS withdrawals_status ON withdrawals(status);

-- 10) Payment Orders (支付订单)
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id),
  amount DECIMAL(20,8) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  payment_url TEXT,
  qr_code TEXT,
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_orders_order_no ON payment_orders(order_no);
CREATE INDEX IF NOT EXISTS payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS payment_orders_status ON payment_orders(status);

-- 11) Top-up Orders (充值订单)
CREATE TABLE IF NOT EXISTS topup_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  amount DECIMAL(20,8) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  wallet_address TEXT,
  payment_url TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12) Withdraw Orders (提现订单)
CREATE TABLE IF NOT EXISTS withdraw_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  amount DECIMAL(20,8) NOT NULL,
  fee DECIMAL(20,8) DEFAULT 0,
  net_amount DECIMAL(20,8) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  method TEXT NOT NULL CHECK (method IN ('crypto', 'bank', 'balance')),
  to_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  tx_hash TEXT,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS withdraw_orders_user_id ON withdraw_orders(user_id);
CREATE INDEX IF NOT EXISTS withdraw_orders_status ON withdraw_orders(status);

-- 13) Platform Revenue (平台收入)
CREATE TABLE IF NOT EXISTS platform_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('commission', 'subscription', 'listing', 'other')),
  source_id TEXT,
  amount DECIMAL(20,8) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'collected', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_revenue_source ON platform_revenue(source_type, source_id);

-- 14) Assistant Hidden/Delisted IDs (租户级别的助手隐藏/下线)
CREATE TABLE IF NOT EXISTS assistant_hidden_ids (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  assistant_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, assistant_id)
);

CREATE TABLE IF NOT EXISTS assistant_delisted_ids (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  assistant_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, assistant_id)
);

-- 15) Assistant Configs (租户级别的助手配置)
CREATE TABLE IF NOT EXISTS assistant_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  assistant_id TEXT NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, assistant_id)
);

CREATE INDEX IF NOT EXISTS assistant_configs_tenant ON assistant_configs(tenant_id);

-- 16) Sessions (会话存储)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_tenant_id ON sessions(tenant_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);

-- 17) Teams (临时组队)
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dissolved')),
  task_id UUID REFERENCES tasks(id),
  max_members INT DEFAULT 10,
  invite_code TEXT UNIQUE NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teams_tenant_id ON teams(tenant_id);
CREATE INDEX IF NOT EXISTS teams_owner_id ON teams(owner_id);
CREATE INDEX IF NOT EXISTS teams_invite_code ON teams(invite_code);

-- 18) Team Members (团队成员)
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'left')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS team_members_user_id ON team_members(user_id);

-- 19) Tasks (任务)
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  skill_id UUID REFERENCES skills(id),
  creator_id UUID NOT NULL REFERENCES users(id),
  assigned_tenant_id UUID REFERENCES tenants(id),
  assigned_user_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  required_skills TEXT[] DEFAULT '{}',
  budget DECIMAL(20,8),
  deadline TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','doing','done','cancelled')),
  match_mode TEXT NOT NULL DEFAULT 'auto' CHECK (match_mode IN ('auto','抢单','派单')),
  openclaw_config JSONB,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_tenant_id ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS tasks_skill_id ON tasks(skill_id);
CREATE INDEX IF NOT EXISTS tasks_creator_id ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_match_mode ON tasks(match_mode);

-- 19.1) Task Subtasks (任务拆分)
CREATE TABLE IF NOT EXISTS task_subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assignee_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','doing','done','cancelled')),
  priority INT DEFAULT 0,
  order_index INT DEFAULT 0,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS task_subtasks_tenant_id ON task_subtasks(tenant_id);
CREATE INDEX IF NOT EXISTS task_subtasks_task_id ON task_subtasks(task_id);
CREATE INDEX IF NOT EXISTS task_subtasks_assignee_id ON task_subtasks(assignee_id);
CREATE INDEX IF NOT EXISTS task_subtasks_status ON task_subtasks(status);

-- 20) OpenClaw Cluster (OpenClaw 集群管理)
CREATE TABLE IF NOT EXISTS openclaw_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('platform', 'self-hosted', 'temporary')),
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy', 'maintenance')),
  url TEXT NOT NULL,
  token_hash TEXT,
  capacity INT DEFAULT 5,
  current_load INT DEFAULT 0,
  region TEXT,
  endpoint_type TEXT DEFAULT 'ws',
  metadata JSONB DEFAULT '{}',
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS openclaw_instances_tenant_id ON openclaw_instances(tenant_id);
CREATE INDEX IF NOT EXISTS openclaw_instances_status ON openclaw_instances(status);
CREATE INDEX IF NOT EXISTS openclaw_instances_region ON openclaw_instances(region);

-- 21) Task Queue (异步任务队列)
CREATE TABLE IF NOT EXISTS task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  payload JSONB NOT NULL,
  result JSONB,
  error TEXT,
  priority INT DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_queue_tenant_id ON task_queue(tenant_id);
CREATE INDEX IF NOT EXISTS task_queue_status ON task_queue(status);
CREATE INDEX IF NOT EXISTS task_queue_type ON task_queue(type);
CREATE INDEX IF NOT EXISTS task_queue_priority ON task_queue(priority);

-- Default tenant for development
INSERT INTO tenants (id, name, slug, type, plan, status)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Default Tenant', 'default', 'individual', 'free', 'active')
ON CONFLICT (id) DO NOTHING;

-- Default user for development
INSERT INTO users (id, display_name, email)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Default User', 'default@example.com')
ON CONFLICT (id) DO NOTHING;