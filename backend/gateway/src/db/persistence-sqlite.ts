/**
 * SQLite persistence for assistants state (devices, assistant_configs JSON blobs, hidden/delisted).
 * Uses Node built-in `node:sqlite` (Node 22+). Mirrors PostgreSQL snapshot shape in persistence-pg.ts.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { AssistantsState } from "../assistants/persistence.js";
import { loadAssistantsState } from "../assistants/persistence.js";

const DEFAULT_TENANT = "default";

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS assistants_devices (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  name TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS assistant_configs (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  persona TEXT NOT NULL DEFAULT '{}',
  tools TEXT NOT NULL DEFAULT '[]',
  "constraints" TEXT NOT NULL DEFAULT '[]',
  cost_control TEXT NOT NULL DEFAULT '{}',
  chat_evaluate_pass_threshold REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS assistant_hidden_ids (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS assistant_delisted_ids (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
`;

function initSchema(db: DatabaseSync): void {
  db.exec(SQLITE_DDL);
}

function isEmptyState(s: AssistantsState): boolean {
  return (
    s.devices.length === 0 &&
    s.configs.length === 0 &&
    s.hiddenIds.length === 0 &&
    s.delistedIds.length === 0
  );
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadFromDb(db: DatabaseSync, tenantId: string): AssistantsState {
  type DevRow = {
    id: string;
    kind: string;
    status: string;
    last_seen_at: number;
    name: string | null;
  };
  type CfgRow = {
    id: string;
    name: string;
    persona: string;
    tools: string;
    constraints: string;
    cost_control: string;
    chat_evaluate_pass_threshold: number | null;
  };

  const devices = db
    .prepare(
      `SELECT id, kind, status, last_seen_at, name FROM assistants_devices WHERE tenant_id = ?`,
    )
    .all(tenantId) as unknown as DevRow[];

  const configs = db
    .prepare(
      `SELECT id, name, persona, tools, "constraints", cost_control, chat_evaluate_pass_threshold
       FROM assistant_configs WHERE tenant_id = ?`,
    )
    .all(tenantId) as unknown as CfgRow[];

  const hiddenRows = db
    .prepare(`SELECT id FROM assistant_hidden_ids WHERE tenant_id = ?`)
    .all(tenantId) as unknown as { id: string }[];

  const delistedRows = db
    .prepare(`SELECT id FROM assistant_delisted_ids WHERE tenant_id = ?`)
    .all(tenantId) as unknown as { id: string }[];

  return {
    devices: devices.map((r) => ({
      id: r.id,
      kind: r.kind as AssistantsState["devices"][0]["kind"],
      status: r.status as AssistantsState["devices"][0]["status"],
      lastSeenAt: Number(r.last_seen_at),
      name: r.name ?? undefined,
    })),
    configs: configs.map((r) => ({
      id: r.id,
      name: r.name,
      persona: parseJson(r.persona, {}),
      tools: parseJson(r.tools, []),
      constraints: parseJson(r.constraints, []),
      costControl: parseJson(r.cost_control, {}),
      chatEvaluatePassThreshold: r.chat_evaluate_pass_threshold ?? undefined,
    })),
    hiddenIds: hiddenRows.map((r) => r.id),
    delistedIds: delistedRows.map((r) => r.id),
  };
}

function saveToDb(db: DatabaseSync, tenantId: string, state: AssistantsState): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`DELETE FROM assistants_devices WHERE tenant_id = ?`).run(tenantId);
    const insDev = db.prepare(
      `INSERT INTO assistants_devices (tenant_id, id, kind, status, last_seen_at, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const d of state.devices) {
      insDev.run(tenantId, d.id, d.kind, d.status, d.lastSeenAt, d.name ?? null);
    }

    db.prepare(`DELETE FROM assistant_configs WHERE tenant_id = ?`).run(tenantId);
    const insCfg = db.prepare(
      `INSERT INTO assistant_configs (tenant_id, id, name, persona, tools, "constraints", cost_control, chat_evaluate_pass_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of state.configs) {
      insCfg.run(
        tenantId,
        c.id,
        c.name,
        JSON.stringify(c.persona ?? {}),
        JSON.stringify(c.tools ?? []),
        JSON.stringify(c.constraints ?? []),
        JSON.stringify(c.costControl ?? {}),
        c.chatEvaluatePassThreshold ?? null,
      );
    }

    db.prepare(`DELETE FROM assistant_hidden_ids WHERE tenant_id = ?`).run(tenantId);
    const insHid = db.prepare(
      `INSERT INTO assistant_hidden_ids (tenant_id, id) VALUES (?, ?)`,
    );
    for (const id of state.hiddenIds) {
      insHid.run(tenantId, id);
    }

    db.prepare(`DELETE FROM assistant_delisted_ids WHERE tenant_id = ?`).run(tenantId);
    const insDel = db.prepare(
      `INSERT INTO assistant_delisted_ids (tenant_id, id) VALUES (?, ?)`,
    );
    for (const id of state.delistedIds) {
      insDel.run(tenantId, id);
    }

    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export type AssistantsSqlitePersistence = {
  load(): Promise<AssistantsState | null>;
  save(state: AssistantsState): void;
  close(): void;
};

/**
 * Open (or create) the SQLite file, ensure schema, and return load/save/close.
 * If the DB snapshot is empty and jsonFallbackPath is set, loads assistants.json once and writes it into SQLite.
 */
export function openAssistantsSqlitePersistence(
  dbPath: string,
  options?: { jsonFallbackPath?: string },
): AssistantsSqlitePersistence {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  initSchema(db);

  return {
    async load(): Promise<AssistantsState | null> {
      try {
        let state = loadFromDb(db, DEFAULT_TENANT);
        if (!isEmptyState(state)) return state;

        const fallback = options?.jsonFallbackPath;
        if (fallback) {
          const fromJson = await loadAssistantsState(fallback);
          if (fromJson && !isEmptyState(fromJson)) {
            saveToDb(db, DEFAULT_TENANT, fromJson);
            return fromJson;
          }
          if (fromJson) return fromJson;
        }
        return state;
      } catch (err) {
        console.error("[gateway] SQLite load error:", err);
        return null;
      }
    },
    save(state: AssistantsState): void {
      try {
        saveToDb(db, DEFAULT_TENANT, state);
      } catch (err) {
        console.error("[gateway] SQLite save error:", err);
        throw err;
      }
    },
    close(): void {
      db.close();
    },
  };
}
