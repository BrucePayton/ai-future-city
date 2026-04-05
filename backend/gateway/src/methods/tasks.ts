import type { AssistantConfigStore } from "../assistants/assistant-config.js";
import {
  buildPersonaSystemPrefix,
  contentViolatesDenyConstraints,
  costMonthlyLimitBlocks,
  estimateTokensM,
  minAcceptPriceBlocks,
} from "../assistants/assistant-config-policy.js";
import { buildWorkspacePlan } from "../collaboration/orchestrator.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";
import type { PgPool } from "../db/client.js";
import { DEFAULT_TENANT_ID, createTenantContext } from "../tenant-context.js";

/**
 * OpenClaw Task Dispatch Methods
 */
export function createTasksMethods(deps: {
  openClaw: OpenClawGatewayService;
  devices: DeviceManager;
  assistantConfig: AssistantConfigStore;
  persistAssistantsData?: () => void | Promise<void>;
}) {
  return {
    "tasks.dispatch": async (params: unknown) => {
      const payload =
        params && typeof params === "object"
          ? (params as {
              workspaceId?: unknown;
              prompt?: unknown;
              assistantId?: unknown;
              taskId?: unknown;
              taskPrice?: unknown;
            })
          : {};

      const workspaceId =
        typeof payload.workspaceId === "string" ? payload.workspaceId : "workspace-demo";
      const prompt = typeof payload.prompt === "string" ? payload.prompt : "No prompt provided.";
      const assistantId =
        typeof payload.assistantId === "string" ? payload.assistantId : undefined;
      const taskPrice = typeof payload.taskPrice === "number" ? payload.taskPrice : undefined;

      const effectiveId = deps.openClaw.resolveDispatchAgentId(assistantId);
      const name = deps.devices.get(effectiveId)?.name ?? effectiveId;
      const config = deps.assistantConfig.getOrDefault(effectiveId, name);

      const deny = contentViolatesDenyConstraints(prompt, config.constraints);
      if (deny.violated) {
        return {
          accepted: false,
          provider: "policy",
          code: "CONSTRAINT_BLOCKED",
          error: `Blocked by constraint: ${deny.rule}`,
        };
      }

      const cost = costMonthlyLimitBlocks(config);
      if (cost.blocked) {
        return {
          accepted: false,
          provider: "policy",
          code: "COST_LIMIT",
          error: cost.reason ?? "Cost policy blocked dispatch",
        };
      }

      const price = minAcceptPriceBlocks(config, taskPrice);
      if (price.blocked) {
        return {
          accepted: false,
          provider: "policy",
          code: "PRICE_TOO_LOW",
          error: price.reason ?? "Price policy blocked dispatch",
        };
      }

      const augmentedPrompt = buildPersonaSystemPrefix(config) + prompt;
      const usageDeltaM = estimateTokensM(augmentedPrompt) + 0.002;

      if (deps.openClaw.isEnabled()) {
        try {
          const dispatch = await deps.openClaw.dispatchTask({
            prompt: augmentedPrompt,
            workspaceId,
            assistantId,
            taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
          });

          const used = config.costControl.tokenUsedThisMonthM ?? 0;
          deps.assistantConfig.update(effectiveId, name, {
            costControl: { tokenUsedThisMonthM: used + usageDeltaM },
          });
          await deps.persistAssistantsData?.();

          return {
            accepted: true,
            provider: "openclaw",
            dispatch,
          };
        } catch (error) {
          return {
            accepted: false,
            provider: "openclaw",
            error: error instanceof Error ? error.message : String(error),
            plan: buildWorkspacePlan({
              workspaceId,
              prompt,
              primaryAssistantId: assistantId,
            }),
          };
        }
      }

      const used = config.costControl.tokenUsedThisMonthM ?? 0;
      deps.assistantConfig.update(effectiveId, name, {
        costControl: { tokenUsedThisMonthM: used + usageDeltaM },
      });
      await deps.persistAssistantsData?.();

      return {
        accepted: true,
        provider: "local-plan",
        plan: buildWorkspacePlan({
          workspaceId,
          prompt,
          primaryAssistantId: assistantId,
        }),
      };
    },
  };
}

/**
 * Skill Marketplace Task Methods - 任务派发 API
 * 用于技能交易平台的任务管理（抢单/派单）
 */
export function createMarketplaceTaskMethods(deps: { pool: PgPool }) {
  const { pool } = deps;

  return {
    /** 创建任务 (marketplace) */
    "marketplace.tasks.create": async (params: unknown) => {
      const input = params as {
        title: string;
        description?: string;
        requiredSkills?: string[];
        skillId?: string;
        budget?: number;
        deadline?: string;
        matchMode?: "auto" | "抢单" | "派单";
        openclawConfig?: Record<string, unknown>;
        creatorId: string;
        tenantId?: string;
      };

      if (!input.title || !input.creatorId) {
        throw new Error("title and creatorId are required");
      }

      const tenantId = input.tenantId || DEFAULT_TENANT_ID;

      const result = await pool.query(
        `INSERT INTO tasks (tenant_id, creator_id, skill_id, title, description, required_skills, budget, deadline, match_mode, openclaw_config, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
         RETURNING *`,
        [
          tenantId,
          input.creatorId,
          input.skillId || null,
          input.title,
          input.description || "",
          input.requiredSkills || [],
          input.budget || null,
          input.deadline ? new Date(input.deadline) : null,
          input.matchMode || "auto",
          input.openclawConfig ? JSON.stringify(input.openclawConfig) : null,
        ],
      );

      return mapMarketplaceTaskRow(result.rows[0]);
    },

    /** 获取任务列表 (marketplace) */
    "marketplace.tasks.list": async (params: unknown) => {
      const query = params as {
        status?: string;
        creatorId?: string;
        assignedUserId?: string;
        skillId?: string;
        matchMode?: string;
        tenantId?: string;
        limit?: number;
        offset?: number;
      };

      const tenantId = query.tenantId || DEFAULT_TENANT_ID;

      let sql = "SELECT * FROM tasks WHERE tenant_id = $1";
      const queryParams: unknown[] = [tenantId];
      let paramIndex = 2;

      if (query.status) {
        sql += ` AND status = $${paramIndex++}`;
        queryParams.push(query.status);
      }
      if (query.creatorId) {
        sql += ` AND creator_id = $${paramIndex++}`;
        queryParams.push(query.creatorId);
      }
      if (query.assignedUserId) {
        sql += ` AND assigned_user_id = $${paramIndex++}`;
        queryParams.push(query.assignedUserId);
      }
      if (query.skillId) {
        sql += ` AND skill_id = $${paramIndex++}`;
        queryParams.push(query.skillId);
      }
      if (query.matchMode) {
        sql += ` AND match_mode = $${paramIndex++}`;
        queryParams.push(query.matchMode);
      }

      const limit = query.limit || 20;
      const offset = query.offset || 0;
      sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      queryParams.push(limit, offset);

      const result = await pool.query(sql, queryParams);

      return result.rows.map(mapMarketplaceTaskRow);
    },

    /** 获取可抢单的任务 */
    "marketplace.tasks.available": async (params: unknown) => {
      const { tenantId, requiredSkills, maxBudget, limit = 20, offset = 0 } = params as {
        tenantId?: string;
        requiredSkills?: string[];
        maxBudget?: number;
        limit?: number;
        offset?: number;
      };

      const tenant = tenantId || DEFAULT_TENANT_ID;

      let sql = `SELECT * FROM tasks WHERE tenant_id = $1 AND status = 'pending' AND match_mode IN ('auto', '抢单')`;
      const queryParams: unknown[] = [tenant];
      let paramIndex = 2;

      if (requiredSkills && requiredSkills.length > 0) {
        sql += ` AND required_skills && $${paramIndex++}`;
        queryParams.push(requiredSkills);
      }

      if (maxBudget) {
        sql += ` AND (budget IS NULL OR budget <= $${paramIndex++})`;
        queryParams.push(maxBudget);
      }

      sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      queryParams.push(limit, offset);

      const result = await pool.query(sql, queryParams);

      return result.rows.map(mapMarketplaceTaskRow);
    },

    /** 抢单 */
    "marketplace.tasks.claim": async (params: unknown) => {
      const { id, userId, tenantId } = params as { id: string; userId: string; tenantId?: string };

      if (!id || !userId) {
        throw new Error("id and userId are required");
      }

      const tenant = tenantId || DEFAULT_TENANT_ID;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const taskResult = await client.query(
          "SELECT * FROM tasks WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
          [id, tenant],
        );

        if (taskResult.rows.length === 0) {
          throw new Error("Task not found");
        }

        const task = mapMarketplaceTaskRow(taskResult.rows[0]);

        if (task.status !== "pending") {
          throw new Error(`Cannot claim task with status: ${task.status}`);
        }

        if (task.matchMode === "派单") {
          throw new Error("This task requires assignment, not claiming");
        }

        await client.query(
          "UPDATE tasks SET status = 'matched', assigned_user_id = $1, updated_at = NOW() WHERE id = $2",
          [userId, id],
        );

        await client.query("COMMIT");

        const updatedResult = await pool.query(
          "SELECT * FROM tasks WHERE id = $1",
          [id],
        );

        return mapMarketplaceTaskRow(updatedResult.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    /** 派单 */
    "marketplace.tasks.assign": async (params: unknown) => {
      const { id, assignedUserId, assignedTenantId, tenantId } = params as {
        id: string;
        assignedUserId: string;
        assignedTenantId?: string;
        tenantId?: string;
      };

      if (!id || !assignedUserId) {
        throw new Error("id and assignedUserId are required");
      }

      const tenant = tenantId || DEFAULT_TENANT_ID;

      const result = await pool.query(
        `UPDATE tasks SET status = 'matched', assigned_user_id = $1, assigned_tenant_id = $2, updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4 RETURNING *`,
        [assignedUserId, assignedTenantId || null, id, tenant],
      );

      if (result.rows.length === 0) {
        throw new Error("Task not found");
      }

      return mapMarketplaceTaskRow(result.rows[0]);
    },

    /** 智能匹配 */
    "marketplace.tasks.match": async (params: unknown) => {
      const { id, tenantId } = params as { id: string; tenantId?: string };

      if (!id) {
        throw new Error("id is required");
      }

      const tenant = tenantId || DEFAULT_TENANT_ID;

      const taskResult = await pool.query(
        "SELECT * FROM tasks WHERE id = $1 AND tenant_id = $2",
        [id, tenant],
      );

      if (taskResult.rows.length === 0) {
        throw new Error("Task not found");
      }

      const task = mapMarketplaceTaskRow(taskResult.rows[0]);

      if (task.status !== "pending") {
        throw new Error("Task is not pending");
      }

      // 基于技能匹配查找候选人
      const skillsResult = await pool.query(
        `SELECT DISTINCT u.id as user_id, u.display_name, s.id as skill_id, s.name as skill_name,
           COALESCE((s.stats->>'avgRating')::numeric, 0) as rating
         FROM users u
         JOIN skills s ON s.owner_id = u.id
         WHERE s.tenant_id = $1 AND s.status = 'published'
           AND s.tags && $2
         ORDER BY rating DESC NULLS LAST
         LIMIT 10`,
        [tenant, task.requiredSkills],
      );

      if (skillsResult.rows.length === 0) {
        return { taskId: id, matched: false, candidates: [] };
      }

      const candidates = skillsResult.rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        skillId: row.skill_id,
        skillName: row.skill_name,
        rating: parseFloat(row.rating) || 0,
        matchScore: Math.random() * 0.3 + 0.7,
      }));

      candidates.sort((a, b) => b.matchScore - a.matchScore);

      return {
        taskId: id,
        matched: true,
        candidates,
        topCandidate: candidates[0],
      };
    },

    /** 更新任务状态 */
    "marketplace.tasks.updateStatus": async (params: unknown) => {
      const { id, status, result, tenantId } = params as {
        id: string;
        status: "pending" | "matched" | "doing" | "done" | "cancelled";
        result?: Record<string, unknown>;
        tenantId?: string;
      };

      if (!id || !status) {
        throw new Error("id and status are required");
      }

      const tenant = tenantId || DEFAULT_TENANT_ID;
      const resultJson = result ? JSON.stringify(result) : null;

      const resultQuery = await pool.query(
        "UPDATE tasks SET status = $1, result = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4 RETURNING *",
        [status, resultJson, id, tenant],
      );

      if (resultQuery.rows.length === 0) {
        throw new Error("Task not found");
      }

      return mapMarketplaceTaskRow(resultQuery.rows[0]);
    },
  };
}

function mapMarketplaceTaskRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    skillId: row.skill_id as string | undefined,
    creatorId: row.creator_id as string,
    assignedTenantId: row.assigned_tenant_id as string | undefined,
    assignedUserId: row.assigned_user_id as string | undefined,
    title: row.title as string,
    description: row.description as string | undefined,
    requiredSkills: (row.required_skills as string[]) || [],
    budget: row.budget ? parseFloat(row.budget as string) : undefined,
    deadline: row.deadline ? new Date(row.deadline as string) : undefined,
    status: row.status as "pending" | "matched" | "doing" | "done" | "cancelled",
    matchMode: row.match_mode as "auto" | "抢单" | "派单",
    openclawConfig: row.openclaw_config as Record<string, unknown> | undefined,
    result: row.result as Record<string, unknown> | undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
