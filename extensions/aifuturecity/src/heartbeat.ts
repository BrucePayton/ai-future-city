import os from "node:os";

import type { OpenClawPluginApi } from "./types.js";
import type { PlatformWsClient } from "./platform-ws.js";

export function startHeartbeatReporter(params: {
  api: OpenClawPluginApi;
  client: PlatformWsClient;
  intervalMs?: number;
}): () => void {
  const intervalMs = params.intervalMs ?? 30_000;

  const timer = setInterval(() => {
    void sendHeartbeat(params.api, params.client);
  }, intervalMs);

  void sendHeartbeat(params.api, params.client);

  return () => {
    clearInterval(timer);
  };
}

async function sendHeartbeat(api: OpenClawPluginApi, client: PlatformWsClient): Promise<void> {
  const customMetrics = (await api.getSystemMetrics?.()) ?? {};

  client.sendEvent("device.heartbeat", {
    hostname: os.hostname(),
    platform: process.platform,
    uptimeSeconds: Math.round(os.uptime()),
    loadAverage: os.loadavg(),
    memory: {
      free: os.freemem(),
      total: os.totalmem(),
    },
    ...customMetrics,
  });
}
