/**
 * B11: Training session store.
 * Contract: backend-training-todo.md B11
 */

import type { TrainingProgressFull } from "./training-store.js";

export type TrainingSessionRecord = {
  id: string;
  assistantId: string;
  createdAt: string; // ISO 8601
  progress?: Partial<TrainingProgressFull>;
};

/** Interface used by HTTP (implemented by TrainingSessionStore and PG store). */
export type ITrainingSessionStore = {
  create(assistantId: string): Promise<TrainingSessionRecord>;
  get(sessionId: string): Promise<TrainingSessionRecord | undefined>;
  update(
    sessionId: string,
    progress: Partial<TrainingProgressFull>,
  ): Promise<void>;
};

export class TrainingSessionStore implements ITrainingSessionStore {
  private readonly sessions = new Map<string, TrainingSessionRecord>();
  private counter = 0;

  async create(assistantId: string): Promise<TrainingSessionRecord> {
    const id = `ts-${Date.now()}-${++this.counter}`;
    const record: TrainingSessionRecord = {
      id,
      assistantId,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(id, record);
    return record;
  }

  async get(sessionId: string): Promise<TrainingSessionRecord | undefined> {
    return this.sessions.get(sessionId);
  }

  async update(
    sessionId: string,
    progress: Partial<TrainingProgressFull>,
  ): Promise<void> {
    const r = this.sessions.get(sessionId);
    if (r) r.progress = { ...r.progress, ...progress };
  }
}
