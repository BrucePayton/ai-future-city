import type { DelistedAssistantIds } from "../assistants/assistant-list-state.js";
import type { HiddenAssistantIds } from "../assistants/assistant-list-state.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";

export type AssistantsListDeps = {
  devices: DeviceManager;
  openClaw: OpenClawGatewayService;
  hiddenIds: HiddenAssistantIds;
  delistedIds: DelistedAssistantIds;
};

export type AssistantListItem = {
  id: string;
  name: string;
  provider: string;
  status: "online" | "offline";
  isDelisted?: boolean;
};

function filterAndMarkDelisted(
  items: AssistantListItem[],
  hiddenIds: HiddenAssistantIds,
  delistedIds: DelistedAssistantIds,
): AssistantListItem[] {
  return items
    .filter((a) => !hiddenIds.has(a.id))
    .map((a) => ({
      ...a,
      isDelisted: delistedIds.has(a.id),
    }));
}

/** Raw merged list (devices + OpenClaw agents) without hidden/delisted filtering. Used to resolve assistant id for DELETE. */
export async function getAssistantsListRaw(deps: {
  devices: DeviceManager;
  openClaw: OpenClawGatewayService;
}): Promise<AssistantListItem[]> {
  const localAssistants: AssistantListItem[] = deps.devices.list().map((device) => ({
    id: device.id,
    name: device.name ?? device.id,
    provider: device.kind,
    status: device.status,
  }));
  if (!deps.openClaw.isEnabled()) {
    return localAssistants;
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
    const byId = new Map<string, AssistantListItem>();
    for (const a of localAssistants) {
      byId.set(a.id, { ...a });
    }
    for (const a of remoteAssistants) {
      const existing = byId.get(a.id);
      byId.set(a.id, {
        id: a.id,
        name: existing?.name ?? a.name,
        provider: "openclaw",
        status: "online",
      });
    }
    return Array.from(byId.values());
  } catch {
    return localAssistants;
  }
}

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
    return {
      assistants: filterAndMarkDelisted(
        localAssistants,
        deps.hiddenIds,
        deps.delistedIds,
      ),
    };
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

    const byId = new Map<string, AssistantListItem>();
    for (const a of localAssistants) {
      byId.set(a.id, { ...a });
    }
    for (const a of remoteAssistants) {
      const existing = byId.get(a.id);
      byId.set(a.id, {
        id: a.id,
        name: existing?.name ?? a.name,
        provider: "openclaw",
        status: "online",
      });
    }

    const merged = filterAndMarkDelisted(
      Array.from(byId.values()),
      deps.hiddenIds,
      deps.delistedIds,
    );
    return { assistants: merged };
  } catch {
    return {
      assistants: filterAndMarkDelisted(
        localAssistants,
        deps.hiddenIds,
        deps.delistedIds,
      ),
    };
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
      deps.hiddenIds.remove(p.id);
      return { ok: true, id: p.id };
    },

    "assistants.list": async () => getAssistantsList(deps),
  };
}
