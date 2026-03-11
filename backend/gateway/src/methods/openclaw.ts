import type { OpenClawGatewayService } from "../openclaw/service.js";

export function createOpenClawMethods(deps: { openClaw: OpenClawGatewayService }) {
  return {
    "openclaw.status": async () => deps.openClaw.getStatus(),
    "openclaw.inspect": async () => deps.openClaw.inspect(),
    "openclaw.agents.list": async () => deps.openClaw.listAgents(),
    "openclaw.tasks.dispatch": async (params: unknown) => {
      const payload =
        params && typeof params === "object"
          ? (params as {
              prompt?: unknown;
              workspaceId?: unknown;
              assistantId?: unknown;
              taskId?: unknown;
            })
          : {};

      return deps.openClaw.dispatchTask({
        prompt: typeof payload.prompt === "string" ? payload.prompt : "No prompt provided.",
        workspaceId:
          typeof payload.workspaceId === "string" ? payload.workspaceId : "workspace-demo",
        assistantId: typeof payload.assistantId === "string" ? payload.assistantId : undefined,
        taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
      });
    },
    "openclaw.chat.send": async (params: unknown) => {
      const payload =
        params && typeof params === "object"
          ? (params as {
              sessionKey?: unknown;
              message?: unknown;
              idempotencyKey?: unknown;
              usePlatformPersona?: unknown;
            })
          : {};
      const sessionKey =
        typeof payload.sessionKey === "string" ? payload.sessionKey : "workspace-demo";
      const usePlatformPersona =
        payload.usePlatformPersona === true ||
        payload.usePlatformPersona === "true" ||
        sessionKey.startsWith("training-");
      const chatParams = {
        sessionKey,
        message: typeof payload.message === "string" ? payload.message : "Hello from AIFutureCity.",
        idempotencyKey:
          typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : undefined,
      };
      if (usePlatformPersona) {
        return deps.openClaw.sendChatForTraining(chatParams);
      }
      return deps.openClaw.sendChat(chatParams);
    },
  };
}
