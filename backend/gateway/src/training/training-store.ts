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

export class TrainingProgressStore {
  private readonly store = new Map<string, TrainingProgressFull>();

  get(assistantId: string): TrainingProgressFull | undefined {
    return this.store.get(assistantId);
  }

  getOrDefault(assistantId: string): TrainingProgressFull {
    return this.store.get(assistantId) ?? defaultProgress();
  }

  update(assistantId: string, payload: TrainingProgressPayload): TrainingProgressFull {
    const current = this.getOrDefault(assistantId);
    const updated: TrainingProgressFull = {
      chat: payload.chat !== undefined ? { ...current.chat, ...payload.chat } : current.chat,
      exec: payload.exec !== undefined ? { ...current.exec, ...payload.exec } : current.exec,
      task: payload.task !== undefined ? { ...current.task, ...payload.task } : current.task,
    };
    this.store.set(assistantId, updated);
    return updated;
  }
}
