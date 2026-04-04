import type { AssistantConfigStore } from "../assistants/assistant-config.js";
import {
  buildPersonaSystemPrefix,
  contentViolatesDenyConstraints,
  costMonthlyLimitBlocks,
  estimateTokensM,
  minAcceptPriceBlocks,
} from "../assistants/assistant-config-policy.js";
import { buildWorkspacePlan } from "../collaboration/orchestrator.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";

export function createTasksMethods(deps: {
  openClaw: OpenClawGatewayService;
  devices: DeviceManager;
  assistantConfig: AssistantConfigStore;
  persistAssistantsData?: () => void | Promise<void>;
}) {
  return {
    "tasks.dispatch": async (params: unknown) => {
      const payload =
        params && typeof params === "object"
          ? (params as {
              workspaceId?: unknown;
              prompt?: unknown;
              assistantId?: unknown;
              taskId?: unknown;
              taskPrice?: unknown;
            })
          : {};

      const workspaceId =
        typeof payload.workspaceId === "string" ? payload.workspaceId : "workspace-demo";
      const prompt = typeof payload.prompt === "string" ? payload.prompt : "No prompt provided.";
      const assistantId =
        typeof payload.assistantId === "string" ? payload.assistantId : undefined;
      const taskPrice = typeof payload.taskPrice === "number" ? payload.taskPrice : undefined;

      const effectiveId = deps.openClaw.resolveDispatchAgentId(assistantId);
      const name = deps.devices.get(effectiveId)?.name ?? effectiveId;
      const config = deps.assistantConfig.getOrDefault(effectiveId, name);

      const deny = contentViolatesDenyConstraints(prompt, config.constraints);
      if (deny.violated) {
        return {
          accepted: false,
          provider: "policy",
          code: "CONSTRAINT_BLOCKED",
          error: `Blocked by constraint: ${deny.rule}`,
        };
      }

      const cost = costMonthlyLimitBlocks(config);
      if (cost.blocked) {
        return {
          accepted: false,
          provider: "policy",
          code: "COST_LIMIT",
          error: cost.reason ?? "Cost policy blocked dispatch",
        };
      }

      const price = minAcceptPriceBlocks(config, taskPrice);
      if (price.blocked) {
        return {
          accepted: false,
          provider: "policy",
          code: "PRICE_TOO_LOW",
          error: price.reason ?? "Price policy blocked dispatch",
        };
      }

      const augmentedPrompt = buildPersonaSystemPrefix(config) + prompt;
      const usageDeltaM = estimateTokensM(augmentedPrompt) + 0.002;

      if (deps.openClaw.isEnabled()) {
        try {
          const dispatch = await deps.openClaw.dispatchTask({
            prompt: augmentedPrompt,
            workspaceId,
            assistantId,
            taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
          });

          const used = config.costControl.tokenUsedThisMonthM ?? 0;
          deps.assistantConfig.update(effectiveId, name, {
            costControl: { tokenUsedThisMonthM: used + usageDeltaM },
          });
          await deps.persistAssistantsData?.();

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

      const used = config.costControl.tokenUsedThisMonthM ?? 0;
      deps.assistantConfig.update(effectiveId, name, {
        costControl: { tokenUsedThisMonthM: used + usageDeltaM },
      });
      await deps.persistAssistantsData?.();

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
