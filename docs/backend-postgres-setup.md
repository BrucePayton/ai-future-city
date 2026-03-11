# 后端 PostgreSQL 数据库配置

当设置 `DATABASE_URL` 时，网关将使用 PostgreSQL 持久化**全部**状态（助手、工作区会话、训练进度与训练会话），并采用多租户表结构（Phase 1 使用默认单租户）。

---

## 一、创建数据库

```bash
# 使用 psql 或任意 PostgreSQL 客户端创建数据库
createdb aifuturecity

# 或通过 psql
psql -U postgres
CREATE DATABASE aifuturecity;
\q
```

---

## 二、初始化 schema

首次使用需执行 schema 建表。两种方式：

**方式 A：环境变量 + 启动网关**

网关在 `DATABASE_URL` 存在时会自动执行 `src/db/schema.sql` 创建表，并插入默认租户（Phase 1 单租户）。

**方式 B：手动执行**

```bash
psql "$DATABASE_URL" -f backend/gateway/src/db/schema.sql
```

Schema 可重复执行（幂等），已有表/列不会重复创建。

---

## 三、配置网关

在 `.env` 或 `.env.local` 中设置：

```env
DATABASE_URL=postgresql://user:password@localhost:5432/aifuturecity
```

示例（本地开发，端口 5433 时）：

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/aifuturecity
```

---

## 四、启动网关

```bash
pnpm --filter @aifc/backend-gateway dev
```

若配置正确，启动日志会出现：

```
[gateway] Using PostgreSQL for assistants persistence
AIFutureCity gateway listening on http://localhost:3001 ...
```

---

## 五、表结构说明（多租户）

| 表名 | 说明 |
|------|------|
| `tenants` | 租户（id UUID, name, slug）；启动时自动插入默认租户 |
| `users` | 用户（归属租户，Phase 2 使用） |
| `workspace_sessions` | 工作区/协作会话（替代原内存 SessionStore） |
| `training_progress` | 按助手的训练进度（chat/exec/task JSONB） |
| `training_sessions` | 训练会话（B11） |
| `assistants_devices` | 已登记设备（含 tenant_id） |
| `assistant_configs` | 助手配置（含 tenant_id） |
| `assistant_hidden_ids` | 已删除（隐藏）助手 ID（主键 tenant_id + id） |
| `assistant_delisted_ids` | 已下架助手 ID（主键 tenant_id + id） |

Phase 1 不解析请求身份，所有读写使用**默认租户**（slug `default`）。Phase 2 将支持从 Header/WS 解析 `tenant_id`、`user_id`。

---

## 六、已有数据迁移

若此前使用 `data/assistants.json` 或旧版 PG 表（无 `tenant_id`），首次执行新 schema 时：

- 会为现有表增加 `tenant_id` 列，默认值为默认租户 UUID。
- 助手相关表主键会改为 `(tenant_id, id)`（若原表仅有 `id`）。

无需单独迁移脚本；直接启动网关并确保 `DATABASE_URL` 已配置即可。

---

## 七、Docker 快速启动 PostgreSQL

```bash
docker run -d --name aifc-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=aifuturecity \
  -p 5433:5432 \
  postgres:16-alpine
```

对应 `DATABASE_URL`：

```
postgresql://postgres:postgres@localhost:5433/aifuturecity
```

（若本机 5432 已被占用，可用 5433 映射容器内 5432。）
