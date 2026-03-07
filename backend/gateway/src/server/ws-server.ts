import type http from "node:http";

import { WebSocketServer } from "ws";

import { isGatewayRequestFrame } from "../protocol/frames.js";
import type { GatewayRequestFrame, GatewayResponseFrame } from "../protocol/frames.js";
import { createMethodRouter } from "./method-router.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";
import type { SessionStore } from "../sessions/session-store.js";

export function attachGatewayWebSocketServer(params: {
  server: http.Server;
  path: string;
  devices: DeviceManager;
  sessions: SessionStore;
  openClaw: OpenClawGatewayService;
}) {
  const router = createMethodRouter({
    devices: params.devices,
    sessions: params.sessions,
    openClaw: params.openClaw,
  });

  const wss = new WebSocketServer({
    server: params.server,
    path: params.path,
  });

  wss.on("connection", (socket) => {
    const conn = socket as typeof socket & { _registeredDeviceId?: string };
    conn.on("close", () => {
      const deviceId = conn._registeredDeviceId;
      if (deviceId) {
        const current = params.devices.get(deviceId);
        if (current) {
          params.devices.upsert({
            ...current,
            status: "offline",
            lastSeenAt: Date.now(),
          });
        }
      }
    });

    socket.send(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        data: {
          nonce: `nonce-${Date.now()}`,
        },
      }),
    );

    socket.on("message", async (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString();

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        socket.send(
          JSON.stringify({
            type: "res",
            id: "invalid-json",
            ok: false,
            error: { code: "INVALID_JSON", message: "Message was not valid JSON." },
          } satisfies GatewayResponseFrame),
        );
        return;
      }

      if (!isGatewayRequestFrame(parsed)) {
        socket.send(
          JSON.stringify({
            type: "res",
            id: "invalid-frame",
            ok: false,
            error: { code: "INVALID_FRAME", message: "Expected RPC request frame." },
          } satisfies GatewayResponseFrame),
        );
        return;
      }

      const frame = parsed as GatewayRequestFrame;

      try {
        if (frame.method === "connect") {
          const paramsConnect = frame.params as { device?: { id: string; kind?: string; name?: string } } | undefined;
          const deviceInfo = paramsConnect?.device;
          if (deviceInfo?.id) {
            const kind = (deviceInfo.kind === "pc" || deviceInfo.kind === "sdk" || deviceInfo.kind === "custom"
              ? deviceInfo.kind
              : "pc") as "pc" | "sdk" | "custom";
            params.devices.upsert({
              id: deviceInfo.id,
              kind,
              status: "online",
              lastSeenAt: Date.now(),
              name: deviceInfo.name,
            });
            conn._registeredDeviceId = deviceInfo.id;
          }

          socket.send(
            JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              result: {
                type: "hello-ok",
                protocol: 1,
                server: { version: "0.1.0" },
                features: {
                  methods: [
                    "connect",
                    "health",
                    "devices.list",
                    "assistants.list",
                    "assistants.register",
                    "workspace.list",
                    "workspace.create",
                    "tasks.dispatch",
                    "tools.list",
                    "openclaw.status",
                    "openclaw.inspect",
                    "openclaw.agents.list",
                    "openclaw.tasks.dispatch",
                    "openclaw.chat.send",
                  ],
                },
              },
            } satisfies GatewayResponseFrame),
          );
          return;
        }

        const result = await router.handle(frame.method, frame.params);
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            result,
          } satisfies GatewayResponseFrame),
        );
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: false,
            error: {
              code: "METHOD_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          } satisfies GatewayResponseFrame),
        );
      }
    });
  });

  return wss;
}
