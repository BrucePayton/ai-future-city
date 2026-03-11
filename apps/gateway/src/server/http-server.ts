import http from "node:http";

import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";
import type { SessionStore } from "../sessions/session-store.js";

export function createHttpServer(deps: {
  devices: DeviceManager;
  sessions: SessionStore;
  openClaw: OpenClawGatewayService;
}) {
  return http.createServer((req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/healthz") {
      void respondJson(res, 200, async () => ({
        ok: true,
        service: "gateway",
        timestamp: Date.now(),
        openClaw: await deps.openClaw.getStatus(),
      }));
      return;
    }

    if (req.url === "/api/overview") {
      void respondJson(res, 200, async () => ({
        devices: deps.devices.list(),
        sessions: deps.sessions.list(),
        openClaw: await deps.openClaw.getStatus(),
      }));
      return;
    }

    if (req.url === "/api/openclaw/agents") {
      void respondJson(res, 200, async () => deps.openClaw.listAgents());
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Not Found" }));
  });
}

async function respondJson(
  res: http.ServerResponse,
  statusCode: number,
  buildPayload: () => Promise<unknown>,
): Promise<void> {
  try {
    const payload = await buildPayload();
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
