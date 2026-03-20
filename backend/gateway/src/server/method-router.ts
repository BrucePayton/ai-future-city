import type { AssistantConfigStore } from "../assistants/assistant-config.js";
import type { DelistedAssistantIds } from "../assistants/assistant-list-state.js";
import type { HiddenAssistantIds } from "../assistants/assistant-list-state.js";
import { createAssistantsMethods } from "../methods/assistants.js";
import { createOpenClawMethods } from "../methods/openclaw.js";
import { createSystemMethods } from "../methods/system.js";
import { createTasksMethods } from "../methods/tasks.js";
import { createWorkspaceMethods } from "../methods/workspace.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";
import type { ISessionStore } from "../sessions/session-store.js";

export type RpcHandler = (params: unknown) => Promise<unknown>;

export function createMethodRouter(deps: {
  devices: DeviceManager;
  sessions: ISessionStore;
  openClaw: OpenClawGatewayService;
  assistantConfig: AssistantConfigStore;
  hiddenIds: HiddenAssistantIds;
  delistedIds: DelistedAssistantIds;
  persistAssistantsData?: () => void | Promise<void>;
}) {
  const handlers: Record<string, RpcHandler> = {
    ...createAssistantsMethods({
      devices: deps.devices,
      openClaw: deps.openClaw,
      hiddenIds: deps.hiddenIds,
      delistedIds: deps.delistedIds,
    }),
    ...createOpenClawMethods({
      openClaw: deps.openClaw,
      devices: deps.devices,
      assistantConfig: deps.assistantConfig,
      persistAssistantsData: deps.persistAssistantsData,
    }),
    ...createTasksMethods({
      openClaw: deps.openClaw,
      devices: deps.devices,
      assistantConfig: deps.assistantConfig,
      persistAssistantsData: deps.persistAssistantsData,
    }),
    ...createWorkspaceMethods({ sessions: deps.sessions }),
    ...createSystemMethods({ devices: deps.devices, openClaw: deps.openClaw }),
  };

  return {
    async handle(method: string, params: unknown): Promise<unknown> {
      const handler = handlers[method];
      if (!handler) {
        throw new Error(`Unsupported method: ${method}`);
      }

      return handler(params);
    },
  };
}
