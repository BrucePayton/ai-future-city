/**
 * OpenClaw Cluster Service - OpenClaw 集群管理
 * 支持多实例注册、心跳检测、负载均衡
 */

import type { PgPool } from "../db/client.js";

export type OpenClawInstanceType = "platform" | "self-hosted" | "temporary";
export type OpenClawInstanceStatus = "online" | "offline" | "busy" | "maintenance";

export interface OpenClawInstance {
  id: string;
  tenantId: string | null;
  name: string;
  type: OpenClawInstanceType;
  status: OpenClawInstanceStatus;
  url: string;
  tokenHash?: string;
  capacity: number;
  currentLoad: number;
  region?: string;
  endpointType: string;
  metadata: Record<string, unknown>;
  lastHeartbeat: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenClawInstanceInput {
  name: string;
  type: OpenClawInstanceType;
  url: string;
  token?: string;
  capacity?: number;
  region?: string;
  tenantId?: string;
}

// 心跳间隔（秒）
const HEARTBEAT_TIMEOUT = 60;
// 负载均衡权重
const LOAD_BALANCE_WEIGHTS = {
  capacity: 0.5,
  responseTime: 0.3,
  reliability: 0.2,
};

export function createOpenClawClusterService(deps: { pool: PgPool }) {
  const { pool } = deps;

  return {
    /** 注册 OpenClaw 实例 */
    async registerInstance(input: OpenClawInstanceInput): Promise<OpenClawInstance> {
      const tokenHash = input.token ? await hashToken(input.token) : undefined;

      const result = await pool.query(
        `INSERT INTO openclaw_instances (tenant_id, name, type, url, token_hash, capacity, region, status, last_heartbeat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'online', NOW())
         RETURNING *`,
        [
          input.tenantId || null,
          input.name,
          input.type,
          input.url,
          tokenHash,
          input.capacity || 5,
          input.region || "default",
        ],
      );

      return mapInstanceRow(result.rows[0]);
    },

    /** 心跳检测 */
    async heartbeat(instanceId: string): Promise<boolean> {
      const result = await pool.query(
        `UPDATE openclaw_instances SET last_heartbeat = NOW(), status = 'online', updated_at = NOW()
         WHERE id = $1 RETURNING id`,
        [instanceId],
      );
      return result.rows.length > 0;
    },

    /** 更新实例负载 */
    async updateLoad(instanceId: string, load: number): Promise<void> {
      await pool.query(
        `UPDATE openclaw_instances SET current_load = $1, updated_at = NOW() WHERE id = $2`,
        [load, instanceId],
      );
    },

    /** 设置实例状态 */
    async setStatus(instanceId: string, status: OpenClawInstanceStatus): Promise<void> {
      await pool.query(
        `UPDATE openclaw_instances SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, instanceId],
      );
    },

    /** 注销实例 */
    async deregister(instanceId: string): Promise<void> {
      await pool.query(
        `DELETE FROM openclaw_instances WHERE id = $1`,
        [instanceId],
      );
    },

    /** 获取实例列表 */
    async listInstances(tenantId?: string, status?: OpenClawInstanceStatus): Promise<OpenClawInstance[]> {
      let sql = "SELECT * FROM openclaw_instances WHERE 1=1";
      const params: unknown[] = [];
      let idx = 1;

      if (tenantId) {
        sql += ` AND (tenant_id = $${idx++} OR tenant_id IS NULL)`;
        params.push(tenantId);
      }
      if (status) {
        sql += ` AND status = $${idx++}`;
        params.push(status);
      }

      sql += " ORDER BY created_at DESC";

      const result = await pool.query(sql, params);
      return result.rows.map(mapInstanceRow);
    },

    /** 获取可用实例（负载均衡） */
    async getAvailableInstance(tenantId?: string): Promise<OpenClawInstance | null> {
      // 清理超时实例
      await this.cleanupStaleInstances();

      let sql = `SELECT * FROM openclaw_instances
                 WHERE status IN ('online', 'busy')
                   AND current_load < capacity`;
      const params: unknown[] = [];
      let idx = 1;

      if (tenantId) {
        sql += ` AND (tenant_id = $${idx++} OR tenant_id IS NULL)`;
        params.push(tenantId);
      }

      sql += " ORDER BY (capacity - current_load) DESC LIMIT 1";

      const result = await pool.query(sql, params);
      return result.rows.length > 0 ? mapInstanceRow(result.rows[0]) : null;
    },

    /** 清理超时离线实例 */
    async cleanupStaleInstances(): Promise<number> {
      const result = await pool.query(
        `UPDATE openclaw_instances
         SET status = 'offline'
         WHERE last_heartbeat < NOW() - INTERVAL '${HEARTBEAT_TIMEOUT} seconds'
           AND status != 'offline'
         RETURNING id`,
      );
      return result.rows.length;
    },

    /** 获取集群统计 */
    async getClusterStats(tenantId?: string): Promise<{
      total: number;
      online: number;
      offline: number;
      busy: number;
      totalCapacity: number;
      totalLoad: number;
    }> {
      let sql = `SELECT
                   COUNT(*) as total,
                   COUNT(*) FILTER (WHERE status = 'online') as online,
                   COUNT(*) FILTER (WHERE status = 'offline') as offline,
                   COUNT(*) FILTER (WHERE status = 'busy') as busy,
                   COALESCE(SUM(capacity), 0) as total_capacity,
                   COALESCE(SUM(current_load), 0) as total_load
                 FROM openclaw_instances`;
      const params: unknown[] = [];
      let idx = 1;

      if (tenantId) {
        sql += ` WHERE tenant_id = $${idx++} OR tenant_id IS NULL`;
        params.push(tenantId);
      }

      const result = await pool.query(sql, params);
      const row = result.rows[0];

      return {
        total: parseInt(row.total, 10),
        online: parseInt(row.online, 10),
        offline: parseInt(row.offline, 10),
        busy: parseInt(row.busy, 10),
        totalCapacity: parseInt(row.total_capacity, 10),
        totalLoad: parseInt(row.total_load, 10),
      };
    },

    /** 任务分配（选择最佳实例） */
    async assignTask(requiredSkills?: string[], preferredRegion?: string): Promise<OpenClawInstance | null> {
      // 清理超时实例
      await this.cleanupStaleInstances();

      // 查找可用实例，优先选择负载低的
      let sql = `SELECT * FROM openclaw_instances
                 WHERE status IN ('online', 'busy')
                   AND (capacity - current_load) > 0`;
      const params: unknown[] = [];
      let idx = 1;

      if (preferredRegion) {
        sql += ` AND region = $${idx++}`;
        params.push(preferredRegion);
      }

      // 按可用容量排序（容量 - 负载）
      sql += ` ORDER BY (capacity - current_load) DESC LIMIT 1`;

      const result = await pool.query(sql, params);

      if (result.rows.length === 0) {
        return null;
      }

      // 更新负载
      const instance = mapInstanceRow(result.rows[0]);
      await this.updateLoad(instance.id, instance.currentLoad + 1);

      return instance;
    },

    /** 释放任务（减少负载） */
    async releaseTask(instanceId: string): Promise<void> {
      const result = await pool.query(
        `UPDATE openclaw_instances
         SET current_load = GREATEST(0, current_load - 1),
             status = CASE WHEN current_load - 1 = 0 THEN 'online' ELSE status END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING current_load`,
        [instanceId],
      );
    },
  };
}

function mapInstanceRow(row: Record<string, unknown>): OpenClawInstance {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    name: row.name as string,
    type: row.type as OpenClawInstanceType,
    status: row.status as OpenClawInstanceStatus,
    url: row.url as string,
    tokenHash: row.token_hash as string | undefined,
    capacity: row.capacity as number,
    currentLoad: row.current_load as number,
    region: row.region as string | undefined,
    endpointType: row.endpoint_type as string || "ws",
    metadata: row.metadata as Record<string, unknown> || {},
    lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}