/**
 * PG-backed store implementations (same interface as in-memory stores).
 */

import type { Pool } from "pg";

import { DEFAULT_TENANT_ID } from "./client.js";
import {
  listWorkspaceSessionsPg,
  createWorkspaceSessionPg,
  seedDefaultWorkspaceSessionIfEmptyPg,
} from "./workspace-sessions-pg.js";
import {
  getTrainingProgressPg,
  getTrainingProgressOptionalPg,
  updateTrainingProgressPg,
  createTrainingSessionPg,
  getTrainingSessionPg,
  updateTrainingSessionPg,
} from "./training-pg.js";
import type { SessionRecord } from "../sessions/session-store.js";
import type {
  TrainingProgressFull,
  TrainingProgressPayload,
} from "../training/training-store.js";
import type { TrainingSessionRecord } from "../training/training-session-store.js";

/** PG-backed SessionStore. */
export function createPgSessionStore(
  pool: Pool,
  tenantId: string = DEFAULT_TENANT_ID,
): {
  list(): Promise<SessionRecord[]>;
  create(title: string): Promise<SessionRecord>;
  seedDefaultIfEmpty(): Promise<void>;
} {
  return {
    async list(): Promise<SessionRecord[]> {
      return listWorkspaceSessionsPg(pool, tenantId);
    },
    async create(title: string): Promise<SessionRecord> {
      return createWorkspaceSessionPg(pool, title, tenantId);
    },
    async seedDefaultIfEmpty(): Promise<void> {
      return seedDefaultWorkspaceSessionIfEmptyPg(pool, tenantId);
    },
  };
}

/** PG-backed TrainingProgressStore. */
export function createPgTrainingProgressStore(
  pool: Pool,
  tenantId: string = DEFAULT_TENANT_ID,
): {
  get(assistantId: string): Promise<TrainingProgressFull | undefined>;
  getOrDefault(assistantId: string): Promise<TrainingProgressFull>;
  update(
    assistantId: string,
    payload: TrainingProgressPayload,
  ): Promise<TrainingProgressFull>;
} {
  return {
    async get(assistantId: string): Promise<TrainingProgressFull | undefined> {
      const r = await getTrainingProgressOptionalPg(pool, assistantId, tenantId);
      return r ?? undefined;
    },
    async getOrDefault(assistantId: string): Promise<TrainingProgressFull> {
      return getTrainingProgressPg(pool, assistantId, tenantId);
    },
    async update(
      assistantId: string,
      payload: TrainingProgressPayload,
    ): Promise<TrainingProgressFull> {
      return updateTrainingProgressPg(pool, assistantId, payload, tenantId);
    },
  };
}

/** PG-backed TrainingSessionStore. */
export function createPgTrainingSessionStore(
  pool: Pool,
  tenantId: string = DEFAULT_TENANT_ID,
): {
  create(assistantId: string): Promise<TrainingSessionRecord>;
  get(sessionId: string): Promise<TrainingSessionRecord | undefined>;
  update(
    sessionId: string,
    progress: Partial<TrainingProgressFull>,
  ): Promise<void>;
} {
  return {
    async create(assistantId: string): Promise<TrainingSessionRecord> {
      return createTrainingSessionPg(pool, assistantId, tenantId);
    },
    async get(sessionId: string): Promise<TrainingSessionRecord | undefined> {
      return getTrainingSessionPg(pool, sessionId, tenantId);
    },
    async update(
      sessionId: string,
      progress: Partial<TrainingProgressFull>,
    ): Promise<void> {
      return updateTrainingSessionPg(pool, sessionId, progress, tenantId);
    },
  };
}
