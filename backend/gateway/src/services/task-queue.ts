/**
 * Task Queue Service - 异步任务队列
 * 支持任务分发、进度跟踪、重试、回调
 */

import type { PgPool } from "../db/client.js";
import { randomUUID } from "node:crypto";

export type TaskQueueStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";
export type TaskType = "openclaw_dispatch" | "skill_purchase" | "match_algorithm" | "payment_process" | "notification";

export interface QueuedTask {
  id: string;
  tenantId: string | null;
  type: TaskType;
  status: TaskQueueStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  priority: number;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskInput {
  type: TaskType;
  payload: Record<string, unknown>;
  priority?: number;
  scheduledAt?: Date;
  maxRetries?: number;
  tenantId?: string;
}

export interface TaskProcessor {
  (payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export function createTaskQueueService(deps: { pool: PgPool }) {
  const { pool } = deps;

  // 任务处理器映射
  const processors = new Map<TaskType, TaskProcessor>();

  return {
    /** 注册任务处理器 */
    registerProcessor(type: TaskType, processor: TaskProcessor): void {
      processors.set(type, processor);
    },

    /** 入队 */
    async enqueue(input: TaskInput): Promise<QueuedTask> {
      const result = await pool.query(
        `INSERT INTO task_queue (tenant_id, type, payload, priority, scheduled_at, max_retries, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING *`,
        [
          input.tenantId || null,
          input.type,
          JSON.stringify(input.payload),
          input.priority || 0,
          input.scheduledAt || null,
          input.maxRetries ?? 3,
        ],
      );

      return mapTaskRow(result.rows[0]);
    },

    /** 获取下一个待处理任务 */
    async dequeue(tenantId?: string): Promise<QueuedTask | null> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 查找最优先的任务
        const result = await client.query(
          `SELECT * FROM task_queue
           WHERE status = 'pending'
             AND (scheduled_at IS NULL OR scheduled_at <= NOW())
             AND (tenant_id = $1 OR tenant_id IS NULL)
           ORDER BY priority DESC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
          [tenantId || null],
        );

        if (result.rows.length === 0) {
          await client.query("ROLLBACK");
          return null;
        }

        // 更新状态为 processing
        await client.query(
          `UPDATE task_queue
           SET status = 'processing', started_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [result.rows[0].id],
        );

        await client.query("COMMIT");
        return mapTaskRow(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    /** 完成任务 */
    async complete(taskId: string, result: Record<string, unknown>): Promise<void> {
      await pool.query(
        `UPDATE task_queue
         SET status = 'completed', result = $1, completed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(result), taskId],
      );
    },

    /** 失败任务 */
    async fail(taskId: string, error: string): Promise<void> {
      // 获取当前重试次数
      const result = await pool.query(
        "SELECT retry_count, max_retries FROM task_queue WHERE id = $1",
        [taskId],
      );

      if (result.rows.length === 0) return;

      const { retry_count, max_retries } = result.rows[0];

      if (retry_count < max_retries) {
        // 重试
        await pool.query(
          `UPDATE task_queue
           SET status = 'pending',
               error = $1,
               retry_count = retry_count + 1,
               scheduled_at = NOW() + INTERVAL '5 seconds',
               updated_at = NOW()
           WHERE id = $2`,
          [error, taskId],
        );
      } else {
        // 超过最大重试次数，标记为失败
        await pool.query(
          `UPDATE task_queue
           SET status = 'failed', error = $1, updated_at = NOW()
           WHERE id = $2`,
          [error, taskId],
        );
      }
    },

    /** 取消任务 */
    async cancel(taskId: string): Promise<void> {
      await pool.query(
        `UPDATE task_queue SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
        [taskId],
      );
    },

    /** 获取任务状态 */
    async getStatus(taskId: string): Promise<QueuedTask | null> {
      const result = await pool.query(
        "SELECT * FROM task_queue WHERE id = $1",
        [taskId],
      );
      return result.rows.length > 0 ? mapTaskRow(result.rows[0]) : null;
    },

    /** 列出任务 */
    async list(tenantId?: string, status?: TaskQueueStatus, limit = 20, offset = 0): Promise<QueuedTask[]> {
      let sql = "SELECT * FROM task_queue WHERE 1=1";
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

      sql += ` ORDER BY priority DESC, created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(limit, offset);

      const result = await pool.query(sql, params);
      return result.rows.map(mapTaskRow);
    },

    /** 消费任务（处理器循环） */
    async processNext(tenantId?: string): Promise<boolean> {
      const task = await this.dequeue(tenantId);
      if (!task) return false;

      const processor = processors.get(task.type);
      if (!processor) {
        await this.fail(task.id, `No processor registered for type: ${task.type}`);
        return false;
      }

      try {
        const result = await processor(task.payload);
        await this.complete(task.id, result);
        return true;
      } catch (error) {
        await this.fail(task.id, error instanceof Error ? error.message : String(error));
        return false;
      }
    },

    /** 批量处理（可配合 setInterval） */
    async processBatch(tenantId: string, count = 5): Promise<number> {
      let processed = 0;
      for (let i = 0; i < count; i++) {
        const success = await this.processNext(tenantId);
        if (!success) break;
        processed++;
      }
      return processed;
    },

    /** 获取统计 */
    async getStats(tenantId?: string): Promise<{
      pending: number;
      processing: number;
      completed: number;
      failed: number;
    }> {
      let sql = `SELECT
                   COUNT(*) FILTER (WHERE status = 'pending') as pending,
                   COUNT(*) FILTER (WHERE status = 'processing') as processing,
                   COUNT(*) FILTER (WHERE status = 'completed') as completed,
                   COUNT(*) FILTER (WHERE status = 'failed') as failed
                 FROM task_queue`;
      const params: unknown[] = [];
      let idx = 1;

      if (tenantId) {
        sql += ` WHERE tenant_id = $${idx++} OR tenant_id IS NULL`;
        params.push(tenantId);
      }

      const result = await pool.query(sql, params);
      const row = result.rows[0];

      return {
        pending: parseInt(row.pending, 10),
        processing: parseInt(row.processing, 10),
        completed: parseInt(row.completed, 10),
        failed: parseInt(row.failed, 10),
      };
    },
  };
}

function mapTaskRow(row: Record<string, unknown>): QueuedTask {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    type: row.type as TaskType,
    status: row.status as TaskQueueStatus,
    payload: row.payload as Record<string, unknown>,
    result: row.result as Record<string, unknown> | undefined,
    error: row.error as string | undefined,
    priority: row.priority as number,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string) : null,
    startedAt: row.started_at ? new Date(row.started_at as string) : null,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    retryCount: row.retry_count as number,
    maxRetries: row.max_retries as number,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}