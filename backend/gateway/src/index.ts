import { loadLocalEnvFiles } from "./config/load-local-env.js";
import { loadGatewayEnv } from "./config/env.js";
import { DeviceManager } from "./devices/device-manager.js";
import { OpenClawGatewayService } from "./openclaw/service.js";
import { SessionStore } from "./sessions/session-store.js";
import { createHttpServer } from "./server/http-server.js";
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

const openClaw = new OpenClawGatewayService(env.openClaw);

const server = createHttpServer({ devices, sessions, openClaw });
attachGatewayWebSocketServer({
  server,
  path: env.wsPath,
  devices,
  sessions,
  openClaw,
});

server.listen(env.port, () => {
  console.log(
    `AIFutureCity gateway listening on http://localhost:${env.port} (ws path: ${env.wsPath})`,
  );
});

process.on("SIGINT", async () => {
  await openClaw.disconnect();
  server.close(() => process.exit(0));
});
