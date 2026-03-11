/**
 * PostgreSQL-backed workspace sessions (replaces in-memory SessionStore when DATABASE_URL is set).
 */

import type { Pool } from "pg";

import { DEFAULT_TENANT_ID } from "./client.js";

export type SessionRecord = {
  id: string;
  title: string;
  status: "active" | "idle";
};

/** List workspace sessions for tenant. */
export async function listWorkspaceSessionsPg(
  pool: Pool,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<SessionRecord[]> {
  const res = await pool.query<{ id: string; title: string; status: string }>(
    "SELECT id, title, status FROM workspace_sessions WHERE tenant_id = $1 ORDER BY created_at",
    [tenantId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as "active" | "idle",
  }));
}

/** Create a workspace session. */
export async function createWorkspaceSessionPg(
  pool: Pool,
  title: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<SessionRecord> {
  const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  await pool.query(
    `INSERT INTO workspace_sessions (id, tenant_id, title, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', NOW(), NOW())`,
    [id, tenantId, title],
  );
  return { id, title, status: "active" };
}

/** Seed default workspace session if none exist (for backward compatibility). */
export async function seedDefaultWorkspaceSessionIfEmptyPg(
  pool: Pool,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  const count = await pool.query(
    "SELECT 1 FROM workspace_sessions WHERE tenant_id = $1 LIMIT 1",
    [tenantId],
  );
  if (count.rowCount === 0) {
    await pool.query(
      `INSERT INTO workspace_sessions (id, tenant_id, title, status, created_at, updated_at)
       VALUES ('workspace-demo', $1, 'Phase 0 demo workspace', 'active', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [tenantId],
    );
  }
}
