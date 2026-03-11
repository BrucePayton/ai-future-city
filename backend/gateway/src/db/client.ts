/**
 * PostgreSQL client for gateway persistence (multi-tenant).
 */

import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type PgPool = pg.Pool;

/** Default tenant UUID for Phase 1 single-tenant. Must match schema.sql default. */
export const DEFAULT_TENANT_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

/** Create a pg Pool for the given connection URL. */
export function createPgPool(connectionUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: connectionUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

/** Initialize schema: create tables and default tenant. */
export async function initSchema(pool: pg.Pool): Promise<void> {
  const schemaPath = join(__dirname, "schema.sql");
  const sql = await readFile(schemaPath, "utf8");
  await pool.query(sql);
}

/** Ensure default tenant exists (idempotent). Called after initSchema. */
export async function ensureDefaultTenant(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (slug) DO NOTHING`,
    [DEFAULT_TENANT_ID, "Default", "default"],
  );
}
