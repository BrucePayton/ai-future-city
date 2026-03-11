import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";
import { getDefaultPlatformTools } from "../tools/tool-catalog.js";

export function createSystemMethods(deps: {
  devices: DeviceManager;
  openClaw: OpenClawGatewayService;
}) {
  return {
    health: async () => {
      const openClaw = await deps.openClaw.getStatus();

      return {
        ok: true,
        devicesOnline: deps.devices.list().filter((device) => device.status === "online").length,
        timestamp: Date.now(),
        openClaw,
      };
    },
    "devices.list": async () => ({
      devices: deps.devices.list(),
    }),
    "tools.list": async () => ({
      tools: getDefaultPlatformTools(),
    }),
  };
}
