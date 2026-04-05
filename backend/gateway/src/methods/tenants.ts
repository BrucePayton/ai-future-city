/**
 * Tenant Management Methods - 租户管理 API
 */

import type { PgPool } from "../db/client.js";

const DEFAULT_TENANT_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

/**
 * 租户上下文 - 从请求中提取
 */
export interface TenantContext {
  tenantId: string;
  userId?: string;
}

export type TenantType = "individual" | "team" | "enterprise";
export type TenantPlan = "free" | "pro" | "enterprise";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  type: TenantType;
  plan: TenantPlan;
  status: "active" | "suspended" | "deleted";
  openclawConfig: {
    type: "platform" | "self-hosted";
    url?: string;
    token?: string;
    instanceType?: string;
  } | null;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type TenantInput = {
  name: string;
  slug?: string;
  type?: TenantType;
  plan?: TenantPlan;
};

export type TenantUpdateInput = {
  name?: string;
  type?: TenantType;
  plan?: TenantPlan;
  status?: "active" | "suspended";
  openclawConfig?: {
    type: "platform" | "self-hosted";
    url?: string;
    token?: string;
    instanceType?: string;
  };
};

export type OpenClawConfigInput = {
  type: "platform" | "self-hosted";
  url?: string;
  token?: string;
  instanceType?: string;
};

export function createTenantMethods(deps: { pool: PgPool }) {
  const { pool } = deps;

  return {
    /** 创建租户 */
    "tenants.create": async (params: unknown) => {
      const input = params as TenantInput;

      if (!input.name) {
        throw new Error("name is required");
      }

      // 生成 slug
      const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");

      // 检查 slug 是否已存在
      const existing = await pool.query(
        "SELECT id FROM tenants WHERE slug = $1",
        [slug],
      );

      if (existing.rows.length > 0) {
        throw new Error("Slug already exists");
      }

      const result = await pool.query(
        `INSERT INTO tenants (name, slug, type, plan, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
         RETURNING *`,
        [input.name, slug, input.type || "individual", input.plan || "free"],
      );

      return mapTenantRow(result.rows[0]);
    },

    /** 获取租户信息 */
    "tenants.get": async (params: unknown) => {
      const { id } = params as { id: string };

      if (!id) {
        throw new Error("tenant id is required");
      }

      const result = await pool.query(
        "SELECT * FROM tenants WHERE id = $1",
        [id],
      );

      if (result.rows.length === 0) {
        throw new Error("Tenant not found");
      }

      return mapTenantRow(result.rows[0]);
    },

    /** 获取租户 by slug */
    "tenants.getBySlug": async (params: unknown) => {
      const { slug } = params as { slug: string };

      if (!slug) {
        throw new Error("slug is required");
      }

      const result = await pool.query(
        "SELECT * FROM tenants WHERE slug = $1",
        [slug],
      );

      if (result.rows.length === 0) {
        throw new Error("Tenant not found");
      }

      return mapTenantRow(result.rows[0]);
    },

    /** 更新租户 */
    "tenants.update": async (params: unknown) => {
      const { id, ...updates } = params as TenantUpdateInput & { id: string };

      if (!id) {
        throw new Error("id is required");
      }

      const setClauses: string[] = [];
      const queryParams: unknown[] = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        queryParams.push(updates.name);
      }
      if (updates.type !== undefined) {
        setClauses.push(`type = $${paramIndex++}`);
        queryParams.push(updates.type);
      }
      if (updates.plan !== undefined) {
        setClauses.push(`plan = $${paramIndex++}`);
        queryParams.push(updates.plan);
      }
      if (updates.status !== undefined) {
        setClauses.push(`status = $${paramIndex++}`);
        queryParams.push(updates.status);
      }

      if (setClauses.length === 0) {
        throw new Error("No fields to update");
      }

      setClauses.push(`updated_at = NOW()`);
      queryParams.push(id);

      const result = await pool.query(
        `UPDATE tenants SET ${setClauses.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        queryParams,
      );

      if (result.rows.length === 0) {
        throw new Error("Tenant not found");
      }

      return mapTenantRow(result.rows[0]);
    },

    /** 配置租户 OpenClaw */
    "tenants.configureOpenClaw": async (params: unknown) => {
      const { tenantId, config } = params as { tenantId: string; config: OpenClawConfigInput };

      if (!tenantId || !config) {
        throw new Error("tenantId and config are required");
      }

      // 存储在 settings JSON 字段中
      const result = await pool.query(
        `UPDATE tenants SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{openclaw}', $1::jsonb), updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [JSON.stringify(config), tenantId],
      );

      if (result.rows.length === 0) {
        throw new Error("Tenant not found");
      }

      return mapTenantRow(result.rows[0]);
    },

    /** 获取租户 OpenClaw 状态 */
    "tenants.getOpenClawStatus": async (params: unknown) => {
      const { tenantId } = params as { tenantId: string };

      if (!tenantId) {
        throw new Error("tenantId is required");
      }

      const result = await pool.query(
        "SELECT settings FROM tenants WHERE id = $1",
        [tenantId],
      );

      if (result.rows.length === 0) {
        throw new Error("Tenant not found");
      }

      const settings = result.rows[0].settings as Record<string, unknown> || {};
      const openclawConfig = settings.openclaw as Record<string, unknown> | undefined;

      if (!openclawConfig) {
        return {
          configured: false,
          type: "platform",
          instanceType: "shared",
        };
      }

      return {
        configured: true,
        type: openclawConfig.type || "platform",
        url: openclawConfig.url,
        instanceType: openclawConfig.instanceType || "shared",
      };
    },

    /** 列出所有租户 (管理员) */
    "tenants.list": async (params: unknown) => {
      const { status, limit = 20, offset = 0 } = params as {
        status?: "active" | "suspended" | "deleted";
        limit?: number;
        offset?: number;
      };

      let sql = "SELECT * FROM tenants";
      const queryParams: unknown[] = [];
      let paramIndex = 1;

      if (status) {
        sql += ` WHERE status = $${paramIndex++}`;
        queryParams.push(status);
      }

      sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      queryParams.push(limit, offset);

      const result = await pool.query(sql, queryParams);

      return result.rows.map(mapTenantRow);
    },

    /** 用户加入租户 */
    "tenants.addUser": async (params: unknown) => {
      const { tenantId, userId, displayName } = params as {
        tenantId: string;
        userId: string;
        displayName?: string;
      };

      if (!tenantId || !userId) {
        throw new Error("tenantId and userId are required");
      }

      const result = await pool.query(
        `INSERT INTO users (tenant_id, id, display_name, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (tenant_id, id) DO UPDATE SET display_name = $3
         RETURNING *`,
        [tenantId, userId, displayName || userId],
      );

      return {
        tenantId: result.rows[0].tenant_id,
        userId: result.rows[0].id,
        displayName: result.rows[0].display_name,
      };
    },

    /** 获取租户用户列表 */
    "tenants.listUsers": async (params: unknown) => {
      const { tenantId, limit = 20, offset = 0 } = params as {
        tenantId: string;
        limit?: number;
        offset?: number;
      };

      const result = await pool.query(
        "SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        [tenantId, limit, offset],
      );

      return result.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        externalId: row.external_id,
        displayName: row.display_name,
        createdAt: row.created_at,
      }));
    },
  };
}

function mapTenantRow(row: Record<string, unknown>): Tenant {
  const settings = row.settings as Record<string, unknown> || {};
  const openclawConfig = settings.openclaw as Record<string, unknown> | undefined;

  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    type: row.type as TenantType,
    plan: row.plan as TenantPlan,
    status: row.status as Tenant["status"],
    openclawConfig: openclawConfig ? {
      type: openclawConfig.type as "platform" | "self-hosted",
      url: openclawConfig.url as string | undefined,
      token: undefined, // 不返回敏感信息
      instanceType: openclawConfig.instanceType as string | undefined,
    } : null,
    settings,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}