import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";

export type AssistantsListDeps = {
  devices: DeviceManager;
  openClaw: OpenClawGatewayService;
};

export type AssistantListItem = {
  id: string;
  name: string;
  provider: string;
  status: "online" | "offline";
};

/** Build merged assistants list (devices + OpenClaw agents). Used by RPC and GET /api/assistants. */
export async function getAssistantsList(deps: AssistantsListDeps): Promise<{
  assistants: AssistantListItem[];
}> {
  const localAssistants: AssistantListItem[] = deps.devices.list().map((device) => ({
    id: device.id,
    name: device.name ?? device.id,
    provider: device.kind,
    status: device.status,
  }));

  if (!deps.openClaw.isEnabled()) {
    return { assistants: localAssistants };
  }

  try {
    const response = (await deps.openClaw.listAgents()) as {
      agents?: Array<{ id?: string; name?: string }>;
    };

    const remoteAssistants: AssistantListItem[] = (response.agents ?? []).map((agent) => ({
      id: agent.id ?? "unknown",
      name: agent.name ?? agent.id ?? "unknown",
      provider: "openclaw",
      status: "online" as const,
    }));

    return { assistants: [...localAssistants, ...remoteAssistants] };
  } catch {
    return { assistants: localAssistants };
  }
}

export function createAssistantsMethods(deps: AssistantsListDeps) {
  return {
    "assistants.register": async (params: unknown) => {
      const p = params as { id: string; name?: string; kind?: "pc" | "sdk" | "custom" } | undefined;
      if (!p?.id || typeof p.id !== "string") {
        throw new Error("assistants.register requires params.id (string)");
      }
      const kind = p.kind ?? "pc";
      deps.devices.upsert({
        id: p.id,
        kind,
        status: "offline",
        lastSeenAt: Date.now(),
        name: p.name,
      });
      return { ok: true, id: p.id };
    },

    "assistants.list": async () => getAssistantsList(deps),
  };
}
