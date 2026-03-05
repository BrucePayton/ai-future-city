import type { PlatformRequestFrame } from "./types.js";
import type { OpenClawPluginApi } from "./types.js";
import type { PlatformWsClient } from "./platform-ws.js";

type TaskDispatchParams = {
  message?: unknown;
  agentId?: unknown;
  workspaceId?: unknown;
  taskId?: unknown;
};

export function createTaskDispatchHandler(params: {
  api: OpenClawPluginApi;
  client: PlatformWsClient;
}) {
  return async (frame: PlatformRequestFrame): Promise<void> => {
    if (frame.method !== "task.dispatch") {
      return;
    }

    const payload = normalizeParams(frame.params);
    if (!payload) {
      params.client.sendResponse(frame.id, {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "task.dispatch requires message, workspaceId and taskId",
        },
      });
      return;
    }

    try {
      const result = await params.api.runAgent({
        message: payload.message,
        agentId: payload.agentId ?? params.api.config.defaultAgentId ?? "default",
        sessionKey: payload.workspaceId,
        idempotencyKey: payload.taskId,
      });

      params.client.sendResponse(frame.id, {
        ok: true,
        result,
      });
    } catch (error) {
      params.api.logger?.error("AIFutureCity task dispatch failed", {
        message: String(error),
      });

      params.client.sendResponse(frame.id, {
        ok: false,
        error: {
          code: "TASK_DISPATCH_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };
}

function normalizeParams(input: unknown): {
  message: string;
  agentId?: string;
  workspaceId: string;
  taskId: string;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as TaskDispatchParams;
  if (
    typeof payload.message !== "string" ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.taskId !== "string"
  ) {
    return null;
  }

  return {
    message: payload.message,
    workspaceId: payload.workspaceId,
    taskId: payload.taskId,
    ...(typeof payload.agentId === "string" ? { agentId: payload.agentId } : {}),
  };
}
