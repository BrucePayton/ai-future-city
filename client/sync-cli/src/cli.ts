#!/usr/bin/env node
/**
 * AIFutureCity sync-cli: sync gateway assistant config to ~/.aifuturecity (SOUL.md, etc.)
 * Commands: init, run, once, status
 */

import { parseArgs } from "node:util";
import {
  loadSyncConfig,
  getSyncConfigPath,
  resolvePaths,
  checkSourcePathHasCoreFiles,
  ensurePlatformOpenClawConfig,
  loadLocalEnvFiles,
  resolvePlatformPort,
} from "./config.js";
import { runOnce } from "./sync.js";
import { runWithHeartbeat } from "./heartbeat.js";

const DEFAULT_PARALLEL = "~/.aifuturecity";
const DEFAULT_OPENCLAW_ASSISTANT_ID = "local-openclaw-001";
const DEFAULT_OPENCLAW_PORT = 18790;

type AssistantType = "openclaw" | "custom";

async function cmdInit(): Promise<void> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const typeStr = (
    await rl.question("AI assistant type? 1) OpenClaw  2) Custom [1]: ")
  ).trim() || "1";
  const assistantType: AssistantType = typeStr === "2" ? "custom" : "openclaw";

  let config: {
    gatewayUrl: string;
    assistantId: string;
    sourceConfigPath: string;
    parallelConfigPath: string;
    pollIntervalMs: number;
    source: "openclaw" | "sdk" | "custom";
    launchOpenClawWithSync: boolean;
    openclawCommand: string;
    openclawPort: number;
    launchInboundBridgeWithSync: boolean;
  };

  if (assistantType === "openclaw") {
    const gatewayUrl =
      (await rl.question(`Gateway base URL [http://localhost:3001]: `)).trim() ||
      "http://localhost:3001";
    const assistantId =
      (await rl.question(`Assistant ID [${DEFAULT_OPENCLAW_ASSISTANT_ID}]: `)).trim() ||
      DEFAULT_OPENCLAW_ASSISTANT_ID;
    const bridgeYes = (
      await rl.question("Launch Inbound Bridge with sync (assistant shows online in gateway)? [y/N]: ")
    )
      .trim()
      .toLowerCase();
    const launchInboundBridgeWithSync = bridgeYes === "y" || bridgeYes === "yes";
    config = {
      gatewayUrl,
      assistantId,
      sourceConfigPath: "~/.openclaw",
      parallelConfigPath: DEFAULT_PARALLEL,
      pollIntervalMs: 30_000,
      source: "openclaw",
      launchOpenClawWithSync: true,
      openclawCommand: "openclaw",
      openclawPort: DEFAULT_OPENCLAW_PORT,
      launchInboundBridgeWithSync,
    };
    console.log("OpenClaw defaults: launch with sync, port 18790, ~/.aifuturecity");
  } else {
    const gatewayUrl =
      (await rl.question(`Gateway base URL (e.g. http://localhost:3001): `)).trim() ||
      "http://localhost:3001";
    const assistantId = (await rl.question(`Assistant ID: `)).trim();
    if (!assistantId) {
      console.error("Assistant ID is required.");
      process.exit(1);
    }
    const sourceConfigPath =
      (await rl.question(`Local AI config path [~/.openclaw]: `)).trim() || "~/.openclaw";
    const parallelConfigPath =
      (await rl.question(`Parallel config path [${DEFAULT_PARALLEL}]: `)).trim() ||
      DEFAULT_PARALLEL;
    const launchYes = (
      await rl.question("Launch OpenClaw with platform persona when running sync? [y/N]: ")
    )
      .trim()
      .toLowerCase();
    const launchOpenClawWithSync = launchYes === "y" || launchYes === "yes";
    let openclawCommand = "openclaw";
    let openclawPort = DEFAULT_OPENCLAW_PORT;
    if (launchOpenClawWithSync) {
      openclawCommand = (await rl.question("OpenClaw command [openclaw]: ")).trim() || "openclaw";
      const portStr = (await rl.question(`Platform OpenClaw port [${DEFAULT_OPENCLAW_PORT}]: `)).trim();
      openclawPort = portStr ? Number.parseInt(portStr, 10) || DEFAULT_OPENCLAW_PORT : DEFAULT_OPENCLAW_PORT;
    }
    const bridgeYes = (
      await rl.question("Launch Inbound Bridge with sync (assistant shows online in gateway)? [y/N]: ")
    )
      .trim()
      .toLowerCase();
    const launchInboundBridgeWithSync = bridgeYes === "y" || bridgeYes === "yes";
    config = {
      gatewayUrl,
      assistantId,
      sourceConfigPath,
      parallelConfigPath,
      pollIntervalMs: 30_000,
      source: "openclaw",
      launchOpenClawWithSync,
      openclawCommand,
      openclawPort,
      launchInboundBridgeWithSync,
    };
  }

  rl.close();

  const { saveSyncConfig, checkSourcePathHasCoreFiles } = await import("./config.js");
  const hasCore = await checkSourcePathHasCoreFiles(config.sourceConfigPath);
  if (!hasCore) {
    console.warn(
      "Warning: source path does not contain all core files (SOUL.md, IDENTITY.md, etc.). Sync will create them in the parallel path.",
    );
  }

  await saveSyncConfig(config);
  console.log(`Config saved to ${resolvePaths(config).syncConfigPath}`);

  if (config.launchOpenClawWithSync) {
    const port = resolvePlatformPort(config);
    const { openclawJsonPath } = await ensurePlatformOpenClawConfig(
      config.parallelConfigPath,
      port,
      undefined,
      config.sourceConfigPath,
    );
    console.log(`Platform OpenClaw config: ${openclawJsonPath} (gateway.port: ${port})`);
    console.log("Run `aifc-sync run` to sync and launch OpenClaw; exit sync-cli to stop.");
  } else {
    console.log("Run `aifc-sync once` or `aifc-sync run`.");
  }
}

async function main(): Promise<void> {
  loadLocalEnvFiles(process.cwd());
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: "string", short: "c" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  const values = parsed.values;
  const positionals = "positionals" in parsed ? (parsed as { positionals?: string[] }).positionals : undefined;

  if (values.help) {
    console.log(`
aifc-sync - AIFutureCity config sync CLI

Commands:
  init    Interactive setup: select AI assistant type (OpenClaw / Custom), then minimal config
  once    Fetch config from gateway and write to parallel path once
  run     Keep WebSocket heartbeat and poll config; update parallel path on change
  status  Show sync config and whether parallel path has core files (read-only)

Options:
  -c, --config <path>  Parallel config path (default: ~/.aifuturecity) for loading sync-config.json
  -h, --help            Show this help
`);
    process.exit(0);
  }

  const parallelPath = values.config ?? DEFAULT_PARALLEL;
  const syncConfig = await loadSyncConfig(parallelPath);
  const command = positionals?.[0] ?? "run";

  if (command === "init") {
    await cmdInit();
    return;
  }

  if (command === "status") {
    if (!syncConfig) {
      console.log("Status: 未 init（No sync config）. Run 'aifc-sync init' first.");
      console.log("Config path:", getSyncConfigPath(parallelPath));
      process.exit(0);
    }
    const { parallelConfigPath } = resolvePaths(syncConfig);
    console.log("gatewayUrl:", syncConfig.gatewayUrl);
    console.log("assistantId:", syncConfig.assistantId);
    console.log("launchOpenClawWithSync:", syncConfig.launchOpenClawWithSync ?? false);
    console.log("launchInboundBridgeWithSync:", syncConfig.launchInboundBridgeWithSync ?? false);
    const effectivePort = resolvePlatformPort(syncConfig);
    const fromEnv = process.env.OPENCLAW_PLATFORM_PORT != null && process.env.OPENCLAW_PLATFORM_PORT !== "";
    console.log("openclawPort:", effectivePort, fromEnv ? "(env override)" : "");
    const hasCoreFiles = await checkSourcePathHasCoreFiles(syncConfig.parallelConfigPath);
    console.log("同步目录是否已有核心文件:", hasCoreFiles ? "是" : "否", `(${parallelConfigPath})`);
    process.exit(0);
  }

  if (!syncConfig) {
    console.error(
      `No sync config found at ${getSyncConfigPath(parallelPath)}. Run 'aifc-sync init' first.`,
    );
    process.exit(1);
  }

  if (command === "once") {
    const result = await runOnce(syncConfig);
    if (!result.ok) {
      console.error("Sync failed:", result.error);
      if (result.error.includes("fetch failed") || result.error.includes("ECONNREFUSED")) {
        console.error("Hint: ensure the gateway is running (e.g. pnpm dev:backend) and gatewayUrl in sync-config.json is correct.");
      }
      process.exit(1);
    }
    console.log("Config synced to", syncConfig.parallelConfigPath);
    return;
  }

  if (command === "run") {
    if (syncConfig.launchOpenClawWithSync) {
      const { parallelConfigPath, sourceConfigPath } = resolvePaths(syncConfig);
      const port = resolvePlatformPort(syncConfig);
      const { openclawJsonPath } = await ensurePlatformOpenClawConfig(
        parallelConfigPath,
        port,
        undefined,
        sourceConfigPath,
      );
      console.log("[aifc-sync] Platform OpenClaw config:", openclawJsonPath, "(gateway.port:", port + ")");
    }
    await runWithHeartbeat(syncConfig);
    return;
  }

  console.error("Unknown command:", command);
  console.error("Commands: init, once, run, status");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
