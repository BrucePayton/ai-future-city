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
