/**
 * PostgreSQL-backed training progress and sessions (replaces in-memory stores when DATABASE_URL is set).
 */

import type { Pool } from "pg";

import { DEFAULT_TENANT_ID } from "./client.js";
import type {
  TrainingProgressFull,
  TrainingProgressPayload,
} from "../training/training-store.js";
import type { TrainingSessionRecord } from "../training/training-session-store.js";

function defaultProgress(): TrainingProgressFull {
  return { chat: {}, exec: {}, task: {} };
}

/** Get training progress for an assistant; returns default when no row. */
export async function getTrainingProgressPg(
  pool: Pool,
  assistantId: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<TrainingProgressFull> {
  const r = await getTrainingProgressRowPg(pool, assistantId, tenantId);
  if (!r)
    return defaultProgress();
  return {
    chat: (r.chat ?? {}) as TrainingProgressFull["chat"],
    exec: (r.exec ?? {}) as TrainingProgressFull["exec"],
    task: (r.task ?? {}) as TrainingProgressFull["task"],
  };
}

/** Get training progress row or null if not found. */
export async function getTrainingProgressOptionalPg(
  pool: Pool,
  assistantId: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<TrainingProgressFull | null> {
  const r = await getTrainingProgressRowPg(pool, assistantId, tenantId);
  if (!r) return null;
  return {
    chat: (r.chat ?? {}) as TrainingProgressFull["chat"],
    exec: (r.exec ?? {}) as TrainingProgressFull["exec"],
    task: (r.task ?? {}) as TrainingProgressFull["task"],
  };
}

async function getTrainingProgressRowPg(
  pool: Pool,
  assistantId: string,
  tenantId: string,
): Promise<{ chat: unknown; exec: unknown; task: unknown } | null> {
  const res = await pool.query<{ chat: unknown; exec: unknown; task: unknown }>(
    "SELECT chat, exec, task FROM training_progress WHERE tenant_id = $1 AND assistant_id = $2",
    [tenantId, assistantId],
  );
  return res.rows[0] ?? null;
}

/** Update training progress (upsert). */
export async function updateTrainingProgressPg(
  pool: Pool,
  assistantId: string,
  payload: TrainingProgressPayload,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<TrainingProgressFull> {
  const current = await getTrainingProgressPg(pool, assistantId, tenantId);
  const updated: TrainingProgressFull = {
    chat: payload.chat !== undefined ? { ...current.chat, ...payload.chat } : current.chat,
    exec: payload.exec !== undefined ? { ...current.exec, ...payload.exec } : current.exec,
    task: payload.task !== undefined ? { ...current.task, ...payload.task } : current.task,
  };
  await pool.query(
    `INSERT INTO training_progress (tenant_id, assistant_id, chat, exec, task, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, NOW())
     ON CONFLICT (tenant_id, assistant_id) DO UPDATE SET
       chat = EXCLUDED.chat,
       exec = EXCLUDED.exec,
       task = EXCLUDED.task,
       updated_at = NOW()`,
    [
      tenantId,
      assistantId,
      JSON.stringify(updated.chat),
      JSON.stringify(updated.exec),
      JSON.stringify(updated.task),
    ],
  );
  return updated;
}

/** Create a training session. */
export async function createTrainingSessionPg(
  pool: Pool,
  assistantId: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<TrainingSessionRecord> {
  const id = `ts-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  await pool.query(
    `INSERT INTO training_sessions (id, tenant_id, assistant_id, created_at, progress, updated_at)
     VALUES ($1, $2, $3, NOW(), '{}', NOW())`,
    [id, tenantId, assistantId],
  );
  return {
    id,
    assistantId,
    createdAt: new Date().toISOString(),
  };
}

/** Get a training session by id (and optionally scope by assistantId). */
export async function getTrainingSessionPg(
  pool: Pool,
  sessionId: string,
  tenantId: string = DEFAULT_TENANT_ID,
  assistantId?: string,
): Promise<TrainingSessionRecord | undefined> {
  let query =
    "SELECT id, assistant_id, created_at, progress FROM training_sessions WHERE id = $1 AND tenant_id = $2";
  const params: (string | undefined)[] = [sessionId, tenantId];
  if (assistantId) {
    query += " AND assistant_id = $3";
    params.push(assistantId);
  }
  const res = await pool.query<{
    id: string;
    assistant_id: string;
    created_at: Date;
    progress: unknown;
  }>(query, params);
  if (res.rows.length === 0) return undefined;
  const r = res.rows[0];
  return {
    id: r.id,
    assistantId: r.assistant_id,
    createdAt: new Date(r.created_at).toISOString(),
    progress: (r.progress ?? {}) as TrainingSessionRecord["progress"],
  };
}

/** Update training session progress. */
export async function updateTrainingSessionPg(
  pool: Pool,
  sessionId: string,
  progress: Partial<TrainingProgressFull>,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  const existing = await getTrainingSessionPg(pool, sessionId, tenantId);
  if (!existing) return;
  const merged = { ...(existing.progress ?? {}), ...progress };
  await pool.query(
    "UPDATE training_sessions SET progress = $1::jsonb, updated_at = NOW() WHERE id = $2 AND tenant_id = $3",
    [JSON.stringify(merged), sessionId, tenantId],
  );
}
