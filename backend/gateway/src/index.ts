import { AssistantConfigStore } from "./assistants/assistant-config.js";
import { loadLocalEnvFiles } from "./config/load-local-env.js";
import { loadGatewayEnv } from "./config/env.js";
import { DeviceManager } from "./devices/device-manager.js";
import { InboundOpenClawRegistry } from "./openclaw/inbound-registry.js";
import { OpenClawGatewayService } from "./openclaw/service.js";
import { SessionStore } from "./sessions/session-store.js";
import { createHttpServer } from "./server/http-server.js";
import { attachOpenClawInboundWs } from "./server/openclaw-inbound-ws.js";
import { attachGatewayWebSocketServer } from "./server/ws-server.js";

loadLocalEnvFiles();
const env = loadGatewayEnv();

const devices = new DeviceManager([
  {
    id: "local-openclaw-001",
    kind: "openclaw",
    status: "online",
    lastSeenAt: Date.now(),
  },
]);

const sessions = new SessionStore([
  {
    id: "workspace-demo",
    title: "Phase 0 demo workspace",
    status: "active",
  },
]);

const inboundTokens = new Set<string>();
if (env.openClaw.inboundToken) inboundTokens.add(env.openClaw.inboundToken);
if (env.openClaw.token) inboundTokens.add(env.openClaw.token);
const openClawInboundRegistry = new InboundOpenClawRegistry(inboundTokens);

const openClaw = new OpenClawGatewayService({
  ...env.openClaw,
  inboundRegistry: openClawInboundRegistry,
});

const assistantConfig = new AssistantConfigStore();

const server = createHttpServer({
  devices,
  sessions,
  openClaw,
  assistantConfig,
});
attachGatewayWebSocketServer({
  server,
  path: env.wsPath,
  devices,
  sessions,
  openClaw,
});

if (env.openClaw.inboundWsPath) {
  attachOpenClawInboundWs({
    server,
    path: env.openClaw.inboundWsPath,
    registry: openClawInboundRegistry,
  });
}

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${env.port} is already in use. Either:\n` +
        `  1) Kill the process: kill $(lsof -ti :${env.port})\n` +
        `  2) Use another port: AIFC_GATEWAY_PORT=3002 pnpm dev:backend\n`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(env.port, () => {
  const inboundHint = env.openClaw.inboundWsPath
    ? `, OpenClaw inbound: ${env.openClaw.inboundWsPath}`
    : "";
  console.log(
    `AIFutureCity gateway listening on http://localhost:${env.port} (ws: ${env.wsPath}${inboundHint})`,
  );
});

process.on("SIGINT", async () => {
  await openClaw.disconnect();
  server.close(() => process.exit(0));
});
