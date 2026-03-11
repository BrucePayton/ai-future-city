/**
 * PostgreSQL persistence for assistants state (multi-tenant).
 */

import type { Pool } from "pg";

import { DEFAULT_TENANT_ID } from "./client.js";
import type { AssistantsState } from "../assistants/persistence.js";

/** Load assistants state from PostgreSQL for the given tenant. */
export async function loadAssistantsStatePg(
  pool: Pool,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<AssistantsState | null> {
  try {
    const [devicesRes, configsRes, hiddenRes, delistedRes] = await Promise.all([
      pool.query<{
        id: string;
        kind: string;
        status: string;
        last_seen_at: string;
        name: string | null;
      }>(
        "SELECT id, kind, status, last_seen_at, name FROM assistants_devices WHERE tenant_id = $1",
        [tenantId],
      ),
      pool.query<{
        id: string;
        name: string;
        persona: unknown;
        tools: unknown;
        constraints: unknown;
        cost_control: unknown;
        chat_evaluate_pass_threshold: number | null;
      }>(
        "SELECT id, name, persona, tools, constraints, cost_control, chat_evaluate_pass_threshold FROM assistant_configs WHERE tenant_id = $1",
        [tenantId],
      ),
      pool.query<{ id: string }>(
        "SELECT id FROM assistant_hidden_ids WHERE tenant_id = $1",
        [tenantId],
      ),
      pool.query<{ id: string }>(
        "SELECT id FROM assistant_delisted_ids WHERE tenant_id = $1",
        [tenantId],
      ),
    ]);

    const devices = devicesRes.rows.map((r) => ({
      id: r.id,
      kind: r.kind as "openclaw" | "sdk" | "pc" | "custom",
      status: r.status as "online" | "offline",
      lastSeenAt: Number(r.last_seen_at),
      name: r.name ?? undefined,
    }));

    const configs = configsRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      persona: (r.persona ?? {}) as AssistantsState["configs"][0]["persona"],
      tools: (r.tools ?? []) as AssistantsState["configs"][0]["tools"],
      constraints: (r.constraints ?? []) as AssistantsState["configs"][0]["constraints"],
      costControl: (r.cost_control ?? {}) as AssistantsState["configs"][0]["costControl"],
      chatEvaluatePassThreshold: r.chat_evaluate_pass_threshold ?? undefined,
    }));

    const hiddenIds = hiddenRes.rows.map((r) => r.id);
    const delistedIds = delistedRes.rows.map((r) => r.id);

    return {
      devices,
      configs,
      hiddenIds,
      delistedIds,
    };
  } catch (err) {
    console.error("[gateway] PostgreSQL load error:", err);
    return null;
  }
}

/** Save assistants state to PostgreSQL for the given tenant. */
export async function saveAssistantsStatePg(
  pool: Pool,
  state: AssistantsState,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM assistants_devices WHERE tenant_id = $1", [tenantId]);
    for (const d of state.devices) {
      await client.query(
        `INSERT INTO assistants_devices (tenant_id, id, kind, status, last_seen_at, name, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [tenantId, d.id, d.kind, d.status, d.lastSeenAt, d.name ?? null],
      );
    }

    await client.query("DELETE FROM assistant_configs WHERE tenant_id = $1", [tenantId]);
    for (const c of state.configs) {
      await client.query(
        `INSERT INTO assistant_configs (tenant_id, id, name, persona, tools, constraints, cost_control, chat_evaluate_pass_threshold, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, NOW())`,
        [
          tenantId,
          c.id,
          c.name,
          JSON.stringify(c.persona ?? {}),
          JSON.stringify(c.tools ?? []),
          JSON.stringify(c.constraints ?? []),
          JSON.stringify(c.costControl ?? {}),
          c.chatEvaluatePassThreshold ?? null,
        ],
      );
    }

    await client.query("DELETE FROM assistant_hidden_ids WHERE tenant_id = $1", [tenantId]);
    for (const id of state.hiddenIds) {
      await client.query(
        "INSERT INTO assistant_hidden_ids (tenant_id, id) VALUES ($1, $2)",
        [tenantId, id],
      );
    }

    await client.query("DELETE FROM assistant_delisted_ids WHERE tenant_id = $1", [tenantId]);
    for (const id of state.delistedIds) {
      await client.query(
        "INSERT INTO assistant_delisted_ids (tenant_id, id) VALUES ($1, $2)",
        [tenantId, id],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[gateway] PostgreSQL save error:", err);
    throw err;
  } finally {
    client.release();
  }
}
