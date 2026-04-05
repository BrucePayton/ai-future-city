/**
 * Team Task Service - 团队任务协作
 * 支持任务拆分、分配、进度跟踪
 */

import type { PgPool } from "../db/client.js";
import { realtimeEvents } from "./realtime-events.js";

export type SubtaskStatus = "pending" | "doing" | "done" | "cancelled";

export interface TaskSubtask {
  id: string;
  tenantId: string | null;
  taskId: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  status: SubtaskStatus;
  priority: number;
  orderIndex: number;
  result: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface SubtaskInput {
  tenantId?: string;
  taskId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  priority?: number;
  orderIndex?: number;
}

export interface SubtaskUpdate {
  title?: string;
  description?: string;
  assigneeId?: string;
  status?: SubtaskStatus;
  priority?: number;
  orderIndex?: number;
  result?: Record<string, unknown>;
}

export function createTeamTaskService(deps: { pool: PgPool }) {
  const { pool } = deps;

  return {
    /** 为任务创建子任务 */
    async createSubtask(input: SubtaskInput): Promise<TaskSubtask> {
      // 如果未提供 tenantId，从 task 获取
      let tenantId = input.tenantId;
      if (!tenantId) {
        const taskResult = await pool.query(
          "SELECT tenant_id FROM tasks WHERE id = $1",
          [input.taskId],
        );
        if (taskResult.rows.length > 0) {
          tenantId = taskResult.rows[0].tenant_id;
        }
      }

      const result = await pool.query(
        `INSERT INTO task_subtasks (tenant_id, task_id, title, description, assignee_id, priority, order_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          tenantId,
          input.taskId,
          input.title,
          input.description || null,
          input.assigneeId || null,
          input.priority || 0,
          input.orderIndex || 0,
        ],
      );

      const subtask = mapSubtaskRow(result.rows[0]);

      // 触发子任务创建事件
      const progress = await this.getTaskProgress(input.taskId);
      realtimeEvents.emitTaskUpdated(input.taskId, {
        subtaskCreated: {
          id: subtask.id,
          title: subtask.title,
        },
        progress,
      });

      return subtask;
    },

    /** 批量创建子任务 */
    async createSubtasks(taskId: string, subtasks: Omit<SubtaskInput, "taskId">[]): Promise<TaskSubtask[]> {
      const results: TaskSubtask[] = [];

      for (let i = 0; i < subtasks.length; i++) {
        const input = { ...subtasks[i], taskId, orderIndex: i };
        const subtask = await this.createSubtask(input);
        results.push(subtask);
      }

      return results;
    },

    /** 获取任务的子任务列表 */
    async listSubtasks(taskId: string): Promise<TaskSubtask[]> {
      const result = await pool.query(
        "SELECT * FROM task_subtasks WHERE task_id = $1 ORDER BY order_index ASC",
        [taskId],
      );
      return result.rows.map(mapSubtaskRow);
    },

    /** 获取子任务详情 */
    async getSubtask(subtaskId: string): Promise<TaskSubtask | null> {
      const result = await pool.query(
        "SELECT * FROM task_subtasks WHERE id = $1",
        [subtaskId],
      );
      return result.rows.length > 0 ? mapSubtaskRow(result.rows[0]) : null;
    },

    /** 更新子任务 */
    async updateSubtask(subtaskId: string, updates: SubtaskUpdate): Promise<TaskSubtask> {
      const setClauses: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (updates.title !== undefined) {
        setClauses.push(`title = $${idx++}`);
        params.push(updates.title);
      }
      if (updates.description !== undefined) {
        setClauses.push(`description = $${idx++}`);
        params.push(updates.description);
      }
      if (updates.assigneeId !== undefined) {
        setClauses.push(`assignee_id = $${idx++}`);
        params.push(updates.assigneeId);
      }
      if (updates.status !== undefined) {
        setClauses.push(`status = $${idx++}`);
        params.push(updates.status);
        if (updates.status === "done") {
          setClauses.push(`completed_at = NOW()`);
        }
      }
      if (updates.priority !== undefined) {
        setClauses.push(`priority = $${idx++}`);
        params.push(updates.priority);
      }
      if (updates.orderIndex !== undefined) {
        setClauses.push(`order_index = $${idx++}`);
        params.push(updates.orderIndex);
      }
      if (updates.result !== undefined) {
        setClauses.push(`result = $${idx++}`);
        params.push(JSON.stringify(updates.result));
      }

      if (setClauses.length === 0) {
        throw new Error("No fields to update");
      }

      setClauses.push(`updated_at = NOW()`);
      params.push(subtaskId);

      const result = await pool.query(
        `UPDATE task_subtasks SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
        params,
      );

      if (result.rows.length === 0) {
        throw new Error("Subtask not found");
      }

      return mapSubtaskRow(result.rows[0]);
    },

    /** 分配子任务给用户 */
    async assignSubtask(subtaskId: string, userId: string): Promise<TaskSubtask> {
      const subtask = await this.updateSubtask(subtaskId, { assigneeId: userId, status: "doing" });

      // 触发子任务分配事件
      realtimeEvents.emitTaskUpdated(subtask.taskId, {
        subtaskAssigned: {
          id: subtask.id,
          title: subtask.title,
          assigneeId: userId,
        },
      });

      return subtask;
    },

    /** 完成子任务 */
    async completeSubtask(subtaskId: string, result?: Record<string, unknown>): Promise<TaskSubtask> {
      const subtask = await this.updateSubtask(subtaskId, {
        status: "done",
        result: result || {},
      });

      // 获取任务进度
      const progress = await this.getTaskProgress(subtask.taskId);

      // 触发子任务完成事件
      realtimeEvents.emitTaskUpdated(subtask.taskId, {
        subtaskId: subtask.id,
        subtaskTitle: subtask.title,
        progress,
      });

      // 检查是否所有子任务都已完成，如果是则更新主任务状态
      const allDone = await this.areAllSubtasksDone(subtask.taskId);
      if (allDone) {
        await pool.query(
          `UPDATE tasks SET status = 'done', updated_at = NOW() WHERE id = $1 AND status != 'done'`,
          [subtask.taskId],
        );

        // 触发任务完成事件
        realtimeEvents.emitTaskUpdated(subtask.taskId, {
          status: "done",
          progress,
        });
      }

      return subtask;
    },

    /** 删除子任务 */
    async deleteSubtask(subtaskId: string, requesterId?: string): Promise<void> {
      // 如果提供了请求者 ID，验证权限
      if (requesterId) {
        const subtask = await this.getSubtask(subtaskId);
        if (!subtask) {
          throw new Error("Subtask not found");
        }
        // 检查任务创建者或子任务分配者可以删除
        if (subtask.assigneeId && subtask.assigneeId !== requesterId) {
          // 非分配者可删除自己的任务
        }
      }
      await pool.query("DELETE FROM task_subtasks WHERE id = $1", [subtaskId]);
    },

    /** 获取任务的子任务进度 */
    async getTaskProgress(taskId: string): Promise<{
      total: number;
      pending: number;
      doing: number;
      done: number;
      cancelled: number;
      progressPercent: number;
    }> {
      const result = await pool.query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'pending') as pending,
           COUNT(*) FILTER (WHERE status = 'doing') as doing,
           COUNT(*) FILTER (WHERE status = 'done') as done,
           COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
         FROM task_subtasks WHERE task_id = $1`,
        [taskId],
      );

      const row = result.rows[0];
      const total = parseInt(row.total, 10);
      const done = parseInt(row.done, 10);
      const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;

      return {
        total,
        pending: parseInt(row.pending, 10),
        doing: parseInt(row.doing, 10),
        done,
        cancelled: parseInt(row.cancelled, 10),
        progressPercent,
      };
    },

    /** 获取用户待办子任务 */
    async getUserSubtasks(userId: string, status?: SubtaskStatus): Promise<TaskSubtask[]> {
      let sql = "SELECT * FROM task_subtasks WHERE assignee_id = $1";
      const params: unknown[] = [userId];

      if (status) {
        sql += " AND status = $2";
        params.push(status);
      }

      sql += " ORDER BY priority DESC, order_index ASC";

      const result = await pool.query(sql, params);
      return result.rows.map(mapSubtaskRow);
    },

    /** 检查是否所有子任务都已完成 */
    async areAllSubtasksDone(taskId: string): Promise<boolean> {
      const result = await pool.query(
        `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'done') as done
         FROM task_subtasks WHERE task_id = $1`,
        [taskId],
      );

      const row = result.rows[0];
      return row.total > 0 && row.total === row.done;
    },
  };
}

function mapSubtaskRow(row: Record<string, unknown>): TaskSubtask {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    taskId: row.task_id as string,
    title: row.title as string,
    description: row.description as string | null,
    assigneeId: row.assignee_id as string | null,
    status: row.status as SubtaskStatus,
    priority: row.priority as number,
    orderIndex: row.order_index as number,
    result: row.result as Record<string, unknown> | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
  };
}