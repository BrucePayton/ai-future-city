import { AssistantConfigStore } from "./assistants/assistant-config.js";
import { DelistedAssistantIds, HiddenAssistantIds } from "./assistants/assistant-list-state.js";
import {
  loadAssistantsState,
  saveAssistantsState,
} from "./assistants/persistence.js";
import { createPgPool, initSchema, ensureDefaultTenant } from "./db/client.js";
import {
  loadAssistantsStatePg,
  saveAssistantsStatePg,
} from "./db/persistence-pg.js";
import {
  createPgSessionStore,
  createPgTrainingProgressStore,
  createPgTrainingSessionStore,
} from "./db/stores-pg.js";
import { loadLocalEnvFiles } from "./config/load-local-env.js";
import { loadGatewayEnv } from "./config/env.js";
import { DeviceManager } from "./devices/device-manager.js";
import { TrainingProgressStore } from "./training/training-store.js";
import { TrainingSessionStore } from "./training/training-session-store.js";
import { InboundOpenClawRegistry } from "./openclaw/inbound-registry.js";
import { OpenClawGatewayService } from "./openclaw/service.js";
import { SessionStore } from "./sessions/session-store.js";
import { createHttpServer } from "./server/http-server.js";
import { attachOpenClawInboundWs } from "./server/openclaw-inbound-ws.js";
import { attachGatewayWebSocketServer } from "./server/ws-server.js";

loadLocalEnvFiles();
const env = loadGatewayEnv();

const assistantsDataPath =
  process.env.AIFC_ASSISTANTS_DATA_PATH ?? "data/assistants.json";

const devices = new DeviceManager([]);
const assistantConfig = new AssistantConfigStore();
const hiddenIds = new HiddenAssistantIds();
const delistedIds = new DelistedAssistantIds();

let pgPool: import("pg").Pool | null = null;

let sessions: import("./sessions/session-store.js").ISessionStore;
let trainingProgress: import("./training/training-store.js").ITrainingProgressStore;
let trainingSessions: import("./training/training-session-store.js").ITrainingSessionStore;

if (env.databaseUrl) {
  pgPool = createPgPool(env.databaseUrl);
  await initSchema(pgPool);
  await ensureDefaultTenant(pgPool);
  const loaded = await loadAssistantsStatePg(pgPool);
  if (loaded) {
    devices.loadFromSnapshot(loaded.devices);
    assistantConfig.loadFromSnapshot(loaded.configs);
    hiddenIds.loadFromSnapshot(loaded.hiddenIds);
    delistedIds.loadFromSnapshot(loaded.delistedIds);
  }
  const pgSessions = createPgSessionStore(pgPool);
  await pgSessions.seedDefaultIfEmpty();
  sessions = pgSessions;
  trainingProgress = createPgTrainingProgressStore(pgPool);
  trainingSessions = createPgTrainingSessionStore(pgPool);
  console.log("[gateway] Using PostgreSQL for assistants persistence");
} else {
  const loaded = await loadAssistantsState(assistantsDataPath);
  if (loaded) {
    devices.loadFromSnapshot(loaded.devices);
    assistantConfig.loadFromSnapshot(loaded.configs);
    hiddenIds.loadFromSnapshot(loaded.hiddenIds);
    delistedIds.loadFromSnapshot(loaded.delistedIds);
  } else {
    devices.upsert({
      id: "local-openclaw-001",
      kind: "openclaw",
      status: "online",
      lastSeenAt: Date.now(),
    });
  }
  sessions = new SessionStore([
    { id: "workspace-demo", title: "Phase 0 demo workspace", status: "active" },
  ]);
  trainingProgress = new TrainingProgressStore();
  trainingSessions = new TrainingSessionStore();
}

const inboundTokens = new Set<string>();
if (env.openClaw.inboundToken) inboundTokens.add(env.openClaw.inboundToken);
if (env.openClaw.token) inboundTokens.add(env.openClaw.token);
const openClawInboundRegistry = new InboundOpenClawRegistry(inboundTokens, {
  onConnectionClosed: (id) => {
    const existing = devices.get(id);
    devices.upsert({
      id,
      kind: "openclaw",
      status: "offline",
      lastSeenAt: Date.now(),
      name: existing?.name,
    });
  },
});

const openClaw = new OpenClawGatewayService({
  ...env.openClaw,
  inboundRegistry: openClawInboundRegistry,
});

const server = createHttpServer({
  devices,
  sessions,
  openClaw,
  assistantConfig,
  trainingProgress,
  trainingSessions,
  hiddenIds,
  delistedIds,
  persistAssistantsData: pgPool
    ? () =>
        saveAssistantsStatePg(pgPool!, {
          devices: devices.list(),
          configs: assistantConfig.list(),
          hiddenIds: hiddenIds.getAll(),
          delistedIds: delistedIds.getAll(),
        })
    : () =>
        saveAssistantsState(
          {
            devices: devices.list(),
            configs: assistantConfig.list(),
            hiddenIds: hiddenIds.getAll(),
            delistedIds: delistedIds.getAll(),
          },
          assistantsDataPath,
        ),
});
attachGatewayWebSocketServer({
  server,
  path: env.wsPath,
  devices,
  sessions,
  openClaw,
  assistantConfig,
  hiddenIds,
  delistedIds,
  persistAssistantsData: pgPool
    ? () =>
        saveAssistantsStatePg(pgPool!, {
          devices: devices.list(),
          configs: assistantConfig.list(),
          hiddenIds: hiddenIds.getAll(),
          delistedIds: delistedIds.getAll(),
        })
    : () =>
        saveAssistantsState(
          {
            devices: devices.list(),
            configs: assistantConfig.list(),
            hiddenIds: hiddenIds.getAll(),
            delistedIds: delistedIds.getAll(),
          },
          assistantsDataPath,
        ),
});

if (env.openClaw.inboundWsPath) {
  attachOpenClawInboundWs({
    server,
    path: env.openClaw.inboundWsPath,
    registry: openClawInboundRegistry,
    devices,
    hiddenIds,
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
  if (pgPool) await pgPool.end();
  server.close(() => process.exit(0));
});
