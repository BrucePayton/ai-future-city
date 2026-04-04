import type { AssistantConfigStore } from "../assistants/assistant-config.js";
import {
  buildPersonaSystemPrefix,
  contentViolatesDenyConstraints,
  costMonthlyLimitBlocks,
  estimateTokensM,
  minAcceptPriceBlocks,
} from "../assistants/assistant-config-policy.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";

function assistantIdFromSessionOrDefault(
  openClaw: OpenClawGatewayService,
  sessionKey: string,
  explicit?: string,
): string {
  const trimmed = typeof explicit === "string" ? explicit.trim() : "";
  if (trimmed) return trimmed;
  if (sessionKey.startsWith("training-")) {
    const rest = sessionKey.slice("training-".length);
    if (rest) return rest;
  }
  return openClaw.resolveDispatchAgentId(undefined);
}

export function createOpenClawMethods(deps: {
  openClaw: OpenClawGatewayService;
  devices: DeviceManager;
  assistantConfig: AssistantConfigStore;
  persistAssistantsData?: () => void | Promise<void>;
}) {
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
              taskPrice?: unknown;
            })
          : {};

      const prompt = typeof payload.prompt === "string" ? payload.prompt : "No prompt provided.";
      const assistantId =
        typeof payload.assistantId === "string" ? payload.assistantId : undefined;
      const taskPrice = typeof payload.taskPrice === "number" ? payload.taskPrice : undefined;
      const effectiveId = deps.openClaw.resolveDispatchAgentId(assistantId);
      const name = deps.devices.get(effectiveId)?.name ?? effectiveId;
      const config = deps.assistantConfig.getOrDefault(effectiveId, name);

      const deny = contentViolatesDenyConstraints(prompt, config.constraints);
      if (deny.violated) {
        throw new Error(`CONSTRAINT_BLOCKED: ${deny.rule}`);
      }
      const cost = costMonthlyLimitBlocks(config);
      if (cost.blocked) {
        throw new Error(`COST_LIMIT: ${cost.reason ?? "Monthly token limit reached"}`);
      }
      const price = minAcceptPriceBlocks(config, taskPrice);
      if (price.blocked) {
        throw new Error(`PRICE_TOO_LOW: ${price.reason ?? "Below minimum accept price"}`);
      }

      const augmentedPrompt = buildPersonaSystemPrefix(config) + prompt;
      const usageDeltaM = estimateTokensM(augmentedPrompt) + 0.002;

      const dispatch = await deps.openClaw.dispatchTask({
        prompt: augmentedPrompt,
        workspaceId:
          typeof payload.workspaceId === "string" ? payload.workspaceId : "workspace-demo",
        assistantId,
        taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
      });

      const used = config.costControl.tokenUsedThisMonthM ?? 0;
      deps.assistantConfig.update(effectiveId, name, {
        costControl: { tokenUsedThisMonthM: used + usageDeltaM },
      });
      await deps.persistAssistantsData?.();

      return dispatch;
    },
    "openclaw.chat.send": async (params: unknown) => {
      const payload =
        params && typeof params === "object"
          ? (params as {
              sessionKey?: unknown;
              message?: unknown;
              idempotencyKey?: unknown;
              usePlatformPersona?: unknown;
              assistantId?: unknown;
              taskPrice?: unknown;
            })
          : {};
      const sessionKey =
        typeof payload.sessionKey === "string" ? payload.sessionKey : "workspace-demo";
      const usePlatformPersona =
        payload.usePlatformPersona === true ||
        payload.usePlatformPersona === "true" ||
        sessionKey.startsWith("training-");
      const rawMessage =
        typeof payload.message === "string" ? payload.message : "Hello from AIFutureCity.";
      const taskPrice = typeof payload.taskPrice === "number" ? payload.taskPrice : undefined;

      const policyAssistantId = assistantIdFromSessionOrDefault(
        deps.openClaw,
        sessionKey,
        typeof payload.assistantId === "string" ? payload.assistantId : undefined,
      );
      const name = deps.devices.get(policyAssistantId)?.name ?? policyAssistantId;
      const config = deps.assistantConfig.getOrDefault(policyAssistantId, name);

      const deny = contentViolatesDenyConstraints(rawMessage, config.constraints);
      if (deny.violated) {
        throw new Error(`CONSTRAINT_BLOCKED: ${deny.rule}`);
      }
      const cost = costMonthlyLimitBlocks(config);
      if (cost.blocked) {
        throw new Error(`COST_LIMIT: ${cost.reason ?? "Monthly token limit reached"}`);
      }
      const price = minAcceptPriceBlocks(config, taskPrice);
      if (price.blocked) {
        throw new Error(`PRICE_TOO_LOW: ${price.reason ?? "Below minimum accept price"}`);
      }

      const prefix = buildPersonaSystemPrefix(config);
      const augmented = prefix ? prefix + rawMessage : rawMessage;

      const chatParams = {
        sessionKey,
        message: augmented,
        idempotencyKey:
          typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : undefined,
      };

      let reply: unknown;
      if (usePlatformPersona) {
        reply = await deps.openClaw.sendChatForTraining(chatParams);
      } else {
        reply = await deps.openClaw.sendChat(chatParams);
      }

      const outText =
        reply && typeof reply === "object" && reply !== null && "content" in reply
          ? String((reply as { content?: unknown }).content ?? "")
          : typeof reply === "string"
            ? reply
            : JSON.stringify(reply);
      const usageDeltaM =
        estimateTokensM(augmented) + Math.max(estimateTokensM(outText), 0.001);
      const used = config.costControl.tokenUsedThisMonthM ?? 0;
      deps.assistantConfig.update(policyAssistantId, name, {
        costControl: { tokenUsedThisMonthM: used + usageDeltaM },
      });
      await deps.persistAssistantsData?.();

      return reply;
    },
  };
}
