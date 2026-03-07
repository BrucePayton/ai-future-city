import http from "node:http";

import type {
  AssistantConfigPayload,
  AssistantConfigStore,
} from "../assistants/assistant-config.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { RegisteredDevice } from "../devices/device-manager.js";
import { getAssistantsList } from "../methods/assistants.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";
import type { SessionStore } from "../sessions/session-store.js";

const ASSISTANT_CONFIG_PATH_RE = /^\/api\/assistants\/([^/]+)\/config$/;

export function createHttpServer(deps: {
  devices: DeviceManager;
  sessions: SessionStore;
  openClaw: OpenClawGatewayService;
  assistantConfig: AssistantConfigStore;
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

    if (req.method === "GET" && req.url === "/api/assistants") {
      void respondJson(res, 200, async () =>
        getAssistantsList({ devices: deps.devices, openClaw: deps.openClaw }),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/api/assistants/register") {
      void handleRegisterAssistant(req, res, deps.devices);
      return;
    }

    const configPathMatch = (req.url ?? "").split("?")[0].match(ASSISTANT_CONFIG_PATH_RE);
    if (configPathMatch) {
      const assistantId = configPathMatch[1];
      if (req.method === "GET") {
        void handleGetAssistantConfig(req, res, assistantId, deps);
        return;
      }
      if (req.method === "PATCH") {
        void handlePatchAssistantConfig(req, res, assistantId, deps);
        return;
      }
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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

type RegisterBody = { id: string; name?: string; kind?: RegisteredDevice["kind"] };

async function handleRegisterAssistant(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  devices: DeviceManager,
): Promise<void> {
  setCorsHeaders(res);
  let body: RegisterBody;
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as RegisterBody;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
    return;
  }
  if (!body?.id || typeof body.id !== "string") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Missing or invalid body.id" }));
    return;
  }
  const kind = body.kind === "pc" || body.kind === "sdk" || body.kind === "custom" ? body.kind : "pc";
  devices.upsert({
    id: body.id,
    kind,
    status: "offline",
    lastSeenAt: Date.now(),
    name: body.name,
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: body.id }));
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

type AssistantConfigDeps = {
  devices: DeviceManager;
  openClaw: OpenClawGatewayService;
  assistantConfig: AssistantConfigStore;
};

async function resolveAssistantById(
  deps: AssistantConfigDeps,
  id: string,
): Promise<{ id: string; name: string } | null> {
  const { assistants } = await getAssistantsList({
    devices: deps.devices,
    openClaw: deps.openClaw,
  });
  const found = assistants.find((a) => a.id === id);
  return found ? { id: found.id, name: found.name } : null;
}

async function handleGetAssistantConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Assistant not found" }));
    return;
  }
  const config = deps.assistantConfig.getOrDefault(assistant.id, assistant.name);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(config));
}

async function handlePatchAssistantConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Assistant not found" }));
    return;
  }
  let body: AssistantConfigPayload;
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as AssistantConfigPayload;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
    return;
  }
  deps.assistantConfig.update(assistant.id, assistant.name, body);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: assistant.id }));
}
