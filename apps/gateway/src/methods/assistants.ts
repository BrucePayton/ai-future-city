import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";

export function createAssistantsMethods(deps: {
  devices: DeviceManager;
  openClaw: OpenClawGatewayService;
}) {
  return {
    "assistants.list": async () => {
      const localAssistants = deps.devices.list().map((device) => ({
        id: device.id,
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

        const remoteAssistants = (response.agents ?? []).map((agent) => ({
          id: agent.id ?? "unknown",
          name: agent.name ?? agent.id ?? "unknown",
          provider: "openclaw",
          status: "online",
        }));

        return { assistants: [...localAssistants, ...remoteAssistants] };
      } catch {
        return { assistants: localAssistants };
      }
    },
  };
}
