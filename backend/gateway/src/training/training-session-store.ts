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

export class TrainingSessionStore {
  private readonly sessions = new Map<string, TrainingSessionRecord>();
  private counter = 0;

  create(assistantId: string): TrainingSessionRecord {
    const id = `ts-${Date.now()}-${++this.counter}`;
    const record: TrainingSessionRecord = {
      id,
      assistantId,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(id, record);
    return record;
  }

  get(sessionId: string): TrainingSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, progress: Partial<TrainingProgressFull>): void {
    const r = this.sessions.get(sessionId);
    if (r) r.progress = { ...r.progress, ...progress };
  }
}
