/**
 * OpenClaw Inbound Bridge
 *
 * Run this on your local PC. It connects to the AIFutureCity gateway (on a server)
 * and forwards requests to your local OpenClaw. Thus "OpenClaw 主动注册到网关".
 *
 * Env (on this PC):
 *   GATEWAY_WS_URL     - Gateway inbound WebSocket URL (e.g. wss://your-server:3001/ws/openclaw-inbound)
 *   OPENCLAW_INBOUND_TOKEN or OPENCLAW_LOCAL_TOKEN - Token for gateway register
 *   OPENCLAW_LOCAL_URL - Local OpenClaw WebSocket (e.g. ws://localhost:18789)
 *   OPENCLAW_LOCAL_TOKEN - Token for local OpenClaw
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

import { OpenClawAdapter } from "../src/client.js";

loadLocalEnv();

const gatewayUrl = process.env.GATEWAY_WS_URL ?? "ws://localhost:3001/ws/openclaw-inbound";
const inboundToken =
  process.env.OPENCLAW_INBOUND_TOKEN ?? process.env.OPENCLAW_LOCAL_TOKEN ?? "";
const localOpenClawUrl = process.env.OPENCLAW_LOCAL_URL ?? "ws://localhost:18789";
const localToken = process.env.OPENCLAW_LOCAL_TOKEN ?? inboundToken;
const assistantId = process.env.OPENCLAW_GATEWAY_ASSISTANT_ID ?? "aifc-gateway";
const defaultAgentId = process.env.OPENCLAW_LOCAL_AGENT_ID ?? "default";

if (!inboundToken) {
  console.error("Set OPENCLAW_INBOUND_TOKEN or OPENCLAW_LOCAL_TOKEN");
  process.exit(1);
}

const adapter = new OpenClawAdapter({
  url: localOpenClawUrl,
  token: localToken,
  assistantId,
  requestTimeoutMs: 25_000,
});

async function run(): Promise<void> {
  await adapter.connect();
  console.log("Connected to local OpenClaw at", localOpenClawUrl);

  const gw = new WebSocket(gatewayUrl);
  gw.on("open", () => {
    gw.send(
      JSON.stringify({
        type: "register",
        token: inboundToken,
        assistantId,
        defaultAgentId,
      }),
    );
  });

  gw.on("message", async (raw) => {
    const text = (raw as Buffer).toString("utf8");
    let msg: { type?: string; event?: string; id?: string; method?: string; params?: unknown; payload?: unknown; data?: unknown };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return;
    }

    if (msg.type === "event") {
      return;
    }
    if (msg.type === "register_ok" || msg.type === "register_error") {
      if (msg.type === "register_ok") {
        const ok = msg as { assistantId?: string };
        console.log("Registered with gateway as", ok.assistantId ?? assistantId);
      } else {
        const err = msg as { error?: string };
        console.error("Gateway register failed:", err.error);
      }
      return;
    }

    if (msg.type !== "req" || typeof msg.id !== "string" || typeof msg.method !== "string") {
      return;
    }

    const { id, method, params = {} } = msg;
    try {
      if (method === "agent") {
        const p = params as {
          message?: string;
          agentId?: string;
          sessionKey?: string;
          idempotencyKey?: string;
          timeout?: number;
        };
        const payload = await adapter.dispatchTask({
          message: p.message ?? "",
          agentId: p.agentId ?? defaultAgentId,
          workspaceId: p.sessionKey ?? "workspace-demo",
          taskId: p.idempotencyKey ?? randomUUID(),
          timeoutSeconds: p.timeout ?? 60,
        });
        gw.send(JSON.stringify({ type: "res", id, ok: true, payload }));
      } else {
        const payload = await adapter.request(method, params);
        gw.send(JSON.stringify({ type: "res", id, ok: true, payload }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      gw.send(
        JSON.stringify({
          type: "res",
          id,
          ok: false,
          error: { code: "BRIDGE_ERROR", message },
        }),
      );
    }
  });

  adapter.onEvent((frame) => {
    if (gw.readyState !== WebSocket.OPEN) return;
    const payload = (frame as { payload?: unknown }).payload ?? (frame as { data?: unknown }).data;
    gw.send(
      JSON.stringify({
        type: "event",
        event: frame.event,
        payload,
      }),
    );
  });

  gw.on("close", (code, reason) => {
    console.log("Gateway connection closed:", code, reason.toString());
    adapter.disconnect();
    process.exit(0);
  });
  gw.on("error", (err) => {
    console.error("Gateway WebSocket error:", err);
    adapter.disconnect();
    process.exit(1);
  });
}

function loadLocalEnv(): void {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const envFiles = [
    path.resolve(dir, "../../../.env.local"),
    path.resolve(dir, "../../.env.local"),
    path.resolve(dir, "../../../.env"),
  ];
  for (const envFile of envFiles) {
    if (!existsSync(envFile)) continue;
    const content = readFileSync(envFile, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/gu, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
