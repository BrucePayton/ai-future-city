/**
 * WebSocket heartbeat + config polling. Run until process exits.
 * Optionally spawns OpenClaw with OPENCLAW_STATE_DIR set; exit sync-cli to stop it (no parent env change).
 * Optionally spawns Inbound Bridge so the assistant shows as online in the gateway.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { SyncConfig } from "./types.js";
import { runOnce } from "./sync.js";
import { fetchAssistantConfig } from "./fetch-config.js";
import { writeConfigToParallelPath } from "./mapping/write-files.js";
import {
  resolvePaths,
  ensurePlatformOpenClawConfig,
  resolvePlatformPort,
  readPlatformAuthToken,
} from "./config.js";

function hashConfig(obj: unknown): string {
  return JSON.stringify(obj);
}

/** Wait until host:port is accepting connections or timeout. Returns true if ready. */
function waitForPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    function tryConnect(): void {
      if (settled) return;
      const socket = new net.Socket();
      const onErr = () => {
        socket.destroy();
        if (settled) return;
        if (Date.now() - start >= timeoutMs) {
          settled = true;
          resolve(false);
          return;
        }
        setTimeout(tryConnect, 400);
      };
      socket.setTimeout(2000);
      socket.on("error", onErr);
      socket.on("timeout", () => {
        socket.destroy();
        onErr();
      });
      socket.connect(port, host, () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(true);
      });
    }
    tryConnect();
  });
}

export async function runWithHeartbeat(config: SyncConfig): Promise<void> {
  const wsUrl = config.gatewayUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
  const pollIntervalMs = config.pollIntervalMs ?? 30_000;
  let lastConfigHash: string | null = null;
  let ws: WebSocket | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let openclawChild: ReturnType<typeof spawn> | null = null;
  let bridgeChild: ReturnType<typeof spawn> | null = null;

  async function pollAndMaybeWrite(): Promise<void> {
    const result = await fetchAssistantConfig(config.gatewayUrl, config.assistantId);
    if (!result.ok) {
      console.warn("[aifc-sync] Fetch config failed:", result.status ? `HTTP ${result.status}` : "network", result.error);
      return;
    }
    const newHash = hashConfig(result.config);
    if (lastConfigHash !== null && newHash === lastConfigHash) return;
    lastConfigHash = newHash;
    const { parallelConfigPath } = resolvePaths(config);
    const writeResult = await writeConfigToParallelPath(parallelConfigPath, result.config);
    if (writeResult.ok) {
      console.log("[aifc-sync] Config written to", parallelConfigPath);
    } else {
      console.warn("[aifc-sync] Write failed:", writeResult.error);
    }
  }

  function connectWs(): void {
    ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      console.log("[aifc-sync] WebSocket connected to", wsUrl);
      ws?.send(JSON.stringify({ type: "req", id: "connect-1", method: "connect", params: {} }));
    });
    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; event?: string; data?: { assistantId?: string } };
        if (msg.type === "event" && msg.event === "config.updated" && msg.data?.assistantId === config.assistantId) {
          void pollAndMaybeWrite();
        }
      } catch {
        // ignore
      }
    });
    ws.on("close", () => {
      ws = null;
      const delay = 800;
      console.log(`[aifc-sync] WebSocket closed, reconnecting in ${delay}ms...`);
      setTimeout(connectWs, delay);
    });
    ws.on("error", () => {
      // close will follow
    });
  }

  function cleanup(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (ws) {
      ws.removeAllListeners();
      ws.close();
      ws = null;
    }
    if (openclawChild) {
      openclawChild.kill("SIGTERM");
      openclawChild = null;
      console.log("[aifc-sync] OpenClaw (platform persona) stopped.");
    }
    if (bridgeChild) {
      bridgeChild.kill("SIGTERM");
      bridgeChild = null;
      console.log("[aifc-sync] Inbound Bridge stopped.");
    }
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Initial sync (SOUL.md etc. to ~/.aifuturecity) — required for platform persona when we start 18790
  const initial = await runOnce(config);
  let syncOk = initial.ok;
  if (!initial.ok) {
    console.error("[aifc-sync] Initial sync failed:", initial.error);
    console.error("[aifc-sync] Check: assistantId must match gateway list (e.g. local-openclaw-001), gateway running.");
  } else {
    const result = await fetchAssistantConfig(config.gatewayUrl, config.assistantId);
    if (result.ok) lastConfigHash = hashConfig(result.config);
    console.log("[aifc-sync] Initial config written to", resolvePaths(config).parallelConfigPath);
  }

  connectWs();
  pollTimer = setInterval(pollAndMaybeWrite, pollIntervalMs);
  console.log("[aifc-sync] Polling config every", pollIntervalMs / 1000, "s");
  // Run one poll immediately so we don't wait a full interval for next write
  void pollAndMaybeWrite();

  if (config.launchOpenClawWithSync) {
    // Ensure platform persona (SOUL.md etc.) is synced before starting 18790, so training uses platform config
    if (!syncOk) {
      const maxRetries = 5;
      const retryDelayMs = 2000;
      console.log(
        "[aifc-sync] Retrying sync up to " + maxRetries + " times before starting platform OpenClaw (ensure gateway is running)...",
      );
      for (let i = 0; i < maxRetries && !syncOk; i++) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        const retry = await runOnce(config);
        if (retry.ok) {
          syncOk = true;
          const result = await fetchAssistantConfig(config.gatewayUrl, config.assistantId);
          if (result.ok) lastConfigHash = hashConfig(result.config);
          console.log("[aifc-sync] Sync succeeded on retry; config written to", resolvePaths(config).parallelConfigPath);
          break;
        }
        console.warn("[aifc-sync] Sync retry " + (i + 1) + "/" + maxRetries + " failed.");
      }
      if (!syncOk) {
        console.warn(
          "[aifc-sync] Platform persona (SOUL.md etc.) was not synced. Start gateway first, then run sync-cli. 18790 will start but training may use placeholder/old persona until next successful sync.",
        );
      }
    }
    const { parallelConfigPath, sourceConfigPath } = resolvePaths(config);
    const cmd = config.openclawCommand ?? "openclaw";
    const port = resolvePlatformPort(config);
    const platformToken =
      process.env.OPENCLAW_PLATFORM_TOKEN ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
    const { openclawJsonPath: openclawConfigPath, effectiveToken } =
      await ensurePlatformOpenClawConfig(
        parallelConfigPath,
        port,
        platformToken || undefined,
        sourceConfigPath,
      );
    const env = {
      ...process.env,
      OPENCLAW_STATE_DIR: parallelConfigPath,
      OPENCLAW_CONFIG_PATH: openclawConfigPath,
      PORT: String(port),
      OPENCLAW_PORT: String(port),
      OPENCLAW_GATEWAY_PORT: String(port),
      OPENCLAW_GATEWAY_TOKEN: effectiveToken,
    };
    const gatewayArgs = ["gateway", "--port", String(port), "--allow-unconfigured"];
    const fullCommand = `${cmd} ${gatewayArgs.join(" ")}`;
    console.log("[aifc-sync] Running:", fullCommand);
    openclawChild = spawn(fullCommand, [], {
      env,
      stdio: "inherit",
      shell: true,
    });
    openclawChild.on("error", (err) => {
      console.warn("[aifc-sync] OpenClaw spawn error:", err.message);
    });
    openclawChild.on("exit", (code, signal) => {
      openclawChild = null;
      if (code != null && code !== 0) {
        console.warn("[aifc-sync] OpenClaw exited with code", code, "- check config or run the logged command manually.");
      }
      if (signal) {
        console.warn("[aifc-sync] OpenClaw exited with signal", signal);
      }
    });
    console.log(
      "[aifc-sync] OpenClaw started with OPENCLAW_STATE_DIR=" +
        parallelConfigPath +
        " OPENCLAW_CONFIG_PATH=" +
        openclawConfigPath +
        " (gateway.port=" +
        port +
        ") (exit sync-cli to stop)",
    );
    console.log("[aifc-sync] 平台实例已启动，将自动推送 token 到网关...");
    // After OpenClaw starts it may overwrite the token; read the actual one and push to gateway
    setTimeout(() => {
      void (async () => {
        const tokenFromFile = await readPlatformAuthToken(parallelConfigPath);
        const tokenToUse =
          tokenFromFile && !tokenFromFile.startsWith("${") ? tokenFromFile : effectiveToken;
        console.log("[aifc-sync] 平台 token:", tokenToUse);
        const gatewayBase = config.gatewayUrl.replace(/\/$/, "");
        try {
          const resp = await fetch(`${gatewayBase}/api/openclaw/platform-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: tokenToUse }),
          });
          if (resp.ok) {
            const data = (await resp.json()) as { ok?: boolean; connected?: boolean };
            if (data.connected) {
              console.log("[aifc-sync] 网关已热更新平台 token 并连接 18790 成功 (platformConnected: true)");
            } else {
              console.warn("[aifc-sync] 网关已热更新平台 token，但未连接 18790；可能需等 18790 就绪后重试");
            }
          } else {
            console.warn("[aifc-sync] 推送 token 到网关失败:", resp.status, await resp.text());
          }
        } catch (err) {
          console.warn(
            "[aifc-sync] 推送 token 到网关失败 (网关可能未启动):",
            err instanceof Error ? err.message : String(err),
            "\n  手动设置: .env.local OPENCLAW_PLATFORM_TOKEN=" + tokenToUse,
          );
        }
      })();
    }, 4000);
  }

  if (config.launchInboundBridgeWithSync) {
    if (openclawChild) {
      const platformPort = resolvePlatformPort(config);
      console.log("[aifc-sync] Waiting for platform OpenClaw port", platformPort, "to be ready...");
      const ready = await waitForPort("127.0.0.1", platformPort, 12_000);
      if (!ready) {
        console.warn("[aifc-sync] Platform port", platformPort, "did not become ready in time; starting Bridge anyway.");
      } else {
        console.log("[aifc-sync] Platform OpenClaw port", platformPort, "ready.");
      }
    }
    const gatewayWsUrl = config.gatewayUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws/openclaw-inbound";
    const inboundToken =
      config.inboundToken ??
      process.env.OPENCLAW_INBOUND_TOKEN ??
      process.env.OPENCLAW_LOCAL_TOKEN ??
      "";
    if (!inboundToken) {
      console.warn(
        "[aifc-sync] Inbound Bridge skipped: set OPENCLAW_INBOUND_TOKEN or OPENCLAW_LOCAL_TOKEN, or add inboundToken to sync-config.json",
      );
    } else {
      const scriptDir = path.dirname(fileURLToPath(import.meta.url));
      const bridgeScriptPath = path.join(scriptDir, "..", "..", "openclaw-adapter", "scripts", "openclaw-inbound-bridge.ts");
      const bridgeScriptPathJs = path.join(scriptDir, "..", "..", "openclaw-adapter", "scripts", "openclaw-inbound-bridge.js");
      const resolved = existsSync(bridgeScriptPath)
        ? bridgeScriptPath
        : existsSync(bridgeScriptPathJs)
          ? bridgeScriptPathJs
          : null;
      if (resolved) {
        const platformPort = resolvePlatformPort(config);
        const env = {
          ...process.env,
          GATEWAY_WS_URL: gatewayWsUrl,
          OPENCLAW_GATEWAY_ASSISTANT_ID: config.assistantId,
          OPENCLAW_INBOUND_TOKEN: inboundToken,
          OPENCLAW_LOCAL_URL: `ws://127.0.0.1:${platformPort}`,
          OPENCLAW_LOCAL_TOKEN: inboundToken,
        };
        const useTsx = resolved.endsWith(".ts");
        bridgeChild = spawn(useTsx ? "npx" : "node", useTsx ? ["tsx", resolved] : [resolved], {
          env,
          stdio: "inherit",
          shell: true,
        });
        bridgeChild.on("error", (err) => {
          console.warn("[aifc-sync] Inbound Bridge spawn error:", err.message);
        });
        bridgeChild.on("exit", (code, signal) => {
          bridgeChild = null;
          if (code != null && code !== 0) console.log("[aifc-sync] Inbound Bridge exited with code", code);
          if (signal) console.log("[aifc-sync] Inbound Bridge exited with signal", signal);
        });
        console.log(
          "[aifc-sync] Inbound Bridge started (gateway " + gatewayWsUrl + ", assistantId=" + config.assistantId + "; exit sync-cli to stop)",
        );
      } else {
        console.warn(
          "[aifc-sync] Inbound Bridge script not found at " +
            bridgeScriptPath +
            "; run bridge manually (e.g. in client/openclaw-adapter: pnpm run bridge:inbound) with GATEWAY_WS_URL, OPENCLAW_GATEWAY_ASSISTANT_ID, OPENCLAW_INBOUND_TOKEN",
        );
      }
    }
  }

  await new Promise<void>(() => {});
}
