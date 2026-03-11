import type http from "node:http";

import { WebSocketServer } from "ws";

import type { HiddenAssistantIds } from "../assistants/assistant-list-state.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { InboundOpenClawRegistry } from "../openclaw/inbound-registry.js";

export function attachOpenClawInboundWs(params: {
  server: http.Server;
  path: string;
  registry: InboundOpenClawRegistry;
  devices: DeviceManager;
  hiddenIds: HiddenAssistantIds;
}) {
  const wss = new WebSocketServer({
    server: params.server,
    path: params.path,
  });

  wss.on("connection", (socket, req) => {
    let registered = false;

    socket.send(
      JSON.stringify({
        type: "event",
        event: "inbound.ready",
        data: { message: "Send register with token to complete handshake." },
      }),
    );

    const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      let parsed: { type?: string; token?: string; assistantId?: string; defaultAgentId?: string };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        socket.send(
          JSON.stringify({
            type: "register_error",
            error: "Invalid JSON",
          }),
        );
        return;
      }

      if (parsed.type !== "register" || registered) {
        return;
      }

      const token = typeof parsed.token === "string" ? parsed.token : "";
      const result = params.registry.register(
        socket,
        token,
        typeof parsed.assistantId === "string" ? parsed.assistantId : undefined,
        typeof parsed.defaultAgentId === "string" ? parsed.defaultAgentId : undefined,
      );

      if (result.ok) {
        registered = true;
        params.devices.upsert({
          id: result.assistantId,
          kind: "openclaw",
          status: "online",
          lastSeenAt: Date.now(),
          name: result.assistantId,
        });
        params.hiddenIds.remove(result.assistantId);
        socket.removeListener("message", onMessage);
        socket.send(
          JSON.stringify({
            type: "register_ok",
            assistantId: result.assistantId,
          }),
        );
      } else {
        socket.send(
          JSON.stringify({
            type: "register_error",
            error: result.error,
          }),
        );
        socket.close(4000, result.error);
      }
    };

    socket.on("message", onMessage);
  });

  return wss;
}
