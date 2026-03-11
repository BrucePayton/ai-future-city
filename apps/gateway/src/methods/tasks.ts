import { buildWorkspacePlan } from "../collaboration/orchestrator.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";

export function createTasksMethods(deps: { openClaw: OpenClawGatewayService }) {
  return {
    "tasks.dispatch": async (params: unknown) => {
      const payload =
        params && typeof params === "object"
          ? (params as {
              workspaceId?: unknown;
              prompt?: unknown;
              assistantId?: unknown;
              taskId?: unknown;
            })
          : {};

      const workspaceId =
        typeof payload.workspaceId === "string" ? payload.workspaceId : "workspace-demo";
      const prompt = typeof payload.prompt === "string" ? payload.prompt : "No prompt provided.";
      const assistantId =
        typeof payload.assistantId === "string" ? payload.assistantId : undefined;

      if (deps.openClaw.isEnabled()) {
        try {
          const dispatch = await deps.openClaw.dispatchTask({
            prompt,
            workspaceId,
            assistantId,
            taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
          });

          return {
            accepted: true,
            provider: "openclaw",
            dispatch,
          };
        } catch (error) {
          return {
            accepted: false,
            provider: "openclaw",
            error: error instanceof Error ? error.message : String(error),
            plan: buildWorkspacePlan({
              workspaceId,
              prompt,
              primaryAssistantId: assistantId,
            }),
          };
        }
      }

      return {
        accepted: true,
        provider: "local-plan",
        plan: buildWorkspacePlan({
          workspaceId,
          prompt,
          primaryAssistantId: assistantId,
        }),
      };
    },
  };
}
