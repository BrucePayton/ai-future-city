/**
 * Training progress store for assistants.
 * Contract: backend-training-todo.md B10
 */

export type TrainingProgressChat = {
  score?: number;
  lastEvaluatedAt?: string; // ISO 8601
};

export type TrainingProgressExecToolResult = {
  toolId: string;
  passed: boolean;
  durationMs?: number;
  error?: string;
};

export type TrainingProgressExec = {
  passRate?: number;
  toolResults?: TrainingProgressExecToolResult[];
};

export type TrainingProgressTask = {
  analyzedCount?: number;
};

export type TrainingProgressPayload = {
  chat?: TrainingProgressChat;
  exec?: TrainingProgressExec;
  task?: TrainingProgressTask;
};

export type TrainingProgressFull = {
  chat: TrainingProgressChat;
  exec: TrainingProgressExec;
  task: TrainingProgressTask;
};

function defaultProgress(): TrainingProgressFull {
  return {
    chat: {},
    exec: {},
    task: {},
  };
}

/** Interface used by HTTP (implemented by TrainingProgressStore and PG store). */
export type ITrainingProgressStore = {
  get(assistantId: string): Promise<TrainingProgressFull | undefined>;
  getOrDefault(assistantId: string): Promise<TrainingProgressFull>;
  update(
    assistantId: string,
    payload: TrainingProgressPayload,
  ): Promise<TrainingProgressFull>;
};

export class TrainingProgressStore implements ITrainingProgressStore {
  private readonly store = new Map<string, TrainingProgressFull>();

  async get(assistantId: string): Promise<TrainingProgressFull | undefined> {
    return this.store.get(assistantId);
  }

  async getOrDefault(assistantId: string): Promise<TrainingProgressFull> {
    return this.store.get(assistantId) ?? defaultProgress();
  }

  async update(
    assistantId: string,
    payload: TrainingProgressPayload,
  ): Promise<TrainingProgressFull> {
    const current = await this.getOrDefault(assistantId);
    const updated: TrainingProgressFull = {
      chat: payload.chat !== undefined ? { ...current.chat, ...payload.chat } : current.chat,
      exec: payload.exec !== undefined ? { ...current.exec, ...payload.exec } : current.exec,
      task: payload.task !== undefined ? { ...current.task, ...payload.task } : current.task,
    };
    this.store.set(assistantId, updated);
    return updated;
  }
}
