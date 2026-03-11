import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "./types.js";

async function parseOpenClawConfig(
  raw: string,
  filePath: string,
): Promise<Record<string, unknown> | null> {
  const needJson5 = filePath.endsWith(".json5") || raw.trimStart().startsWith("//");
  if (needJson5) {
    try {
      const m = await import("json5");
      return m.default.parse(raw) as Record<string, unknown>;
    } catch {
      // fallback to JSON in case of comment-only content
    }
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const SYNC_CONFIG_FILENAME = "sync-config.json";

/** Env key for platform OpenClaw port. When set, overrides sync-config openclawPort. */
export const OPENCLAW_PLATFORM_PORT_ENV = "OPENCLAW_PLATFORM_PORT";

/**
 * Load .env.local and .env from baseDir. Only sets process.env for keys not already set.
 */
export function loadLocalEnvFiles(baseDir: string): void {
  const candidates = [path.join(baseDir, ".env.local"), path.join(baseDir, ".env")];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const content = readFileSync(candidate, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const sep = line.indexOf("=");
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim().replace(/^['"]|['"]$/gu, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

/**
 * Resolve platform OpenClaw port: OPENCLAW_PLATFORM_PORT env (if set and valid) overrides config.
 */
export function resolvePlatformPort(config: { openclawPort?: number }): number {
  const envVal = process.env[OPENCLAW_PLATFORM_PORT_ENV];
  if (envVal != null && envVal !== "") {
    const n = Number.parseInt(envVal, 10);
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  }
  return config.openclawPort ?? 18790;
}

function resolveHome(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return home ? `${home}${p.slice(1)}` : p;
  }
  return p;
}

/**
 * Resolve path to sync config file under parallel config dir.
 * Default: ~/.aifuturecity/sync-config.json
 */
export function getSyncConfigPath(parallelConfigPath: string): string {
  return `${resolveHome(parallelConfigPath).replace(/\/$/, "")}/${SYNC_CONFIG_FILENAME}`;
}

export function resolvePaths(config: SyncConfig): {
  sourceConfigPath: string;
  parallelConfigPath: string;
  syncConfigPath: string;
} {
  const source = resolveHome(config.sourceConfigPath).replace(/\/$/, "");
  const parallel = resolveHome(config.parallelConfigPath).replace(/\/$/, "");
  return {
    sourceConfigPath: source,
    parallelConfigPath: parallel,
    syncConfigPath: `${parallel}/${SYNC_CONFIG_FILENAME}`,
  };
}

export async function loadSyncConfig(parallelConfigPath: string): Promise<SyncConfig | null> {
  const configPath = getSyncConfigPath(parallelConfigPath);
  try {
    const raw = await readFile(configPath, "utf8");
    const data = JSON.parse(raw) as SyncConfig;
    if (typeof data.gatewayUrl === "string" && typeof data.assistantId === "string") {
      return {
        ...data,
        sourceConfigPath: data.sourceConfigPath ?? "~/.openclaw",
        parallelConfigPath: data.parallelConfigPath ?? "~/.aifuturecity",
        pollIntervalMs: data.pollIntervalMs ?? 30_000,
        launchOpenClawWithSync: data.launchOpenClawWithSync ?? false,
        openclawCommand: typeof data.openclawCommand === "string" ? data.openclawCommand : "openclaw",
        openclawPort: typeof data.openclawPort === "number" ? data.openclawPort : 18790,
        launchInboundBridgeWithSync: data.launchInboundBridgeWithSync ?? false,
        inboundToken: typeof data.inboundToken === "string" ? data.inboundToken : undefined,
      };
    }
  } catch {
    // file not found or invalid
  }
  return null;
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  const { parallelConfigPath, syncConfigPath } = resolvePaths(config);
  await mkdir(parallelConfigPath, { recursive: true });
  await writeFile(
    syncConfigPath,
    JSON.stringify(
      {
        gatewayUrl: config.gatewayUrl,
        assistantId: config.assistantId,
        sourceConfigPath: config.sourceConfigPath,
        parallelConfigPath: config.parallelConfigPath,
        pollIntervalMs: config.pollIntervalMs ?? 30_000,
        source: config.source ?? "openclaw",
        launchOpenClawWithSync: config.launchOpenClawWithSync ?? false,
        openclawCommand: config.openclawCommand ?? "openclaw",
        openclawPort: config.openclawPort ?? 18790,
        launchInboundBridgeWithSync: config.launchInboundBridgeWithSync ?? false,
        inboundToken: config.inboundToken,
      },
      null,
      2,
    ),
    "utf8",
  );
}

/** Check if source path contains expected core files (read-only). */
export const CORE_FILES = ["SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md", "TOOLS.md"] as const;

export async function checkSourcePathHasCoreFiles(sourceConfigPath: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  const base = resolveHome(sourceConfigPath);
  for (const name of CORE_FILES) {
    try {
      await access(`${base}/${name}`);
    } catch {
      return false;
    }
  }
  return true;
}

const OPENCLAW_JSON_FILENAME = "openclaw.json";
const OPENCLAW_CONFIG_JSON5 = "config.json5";
const AUTH_PROFILES_FILENAME = "auth-profiles.json";
const MAIN_AGENT_AUTH_RELATIVE = path.join("agents", "main", "agent", AUTH_PROFILES_FILENAME);

/**
 * Read OpenClaw config from source dir (~/.openclaw). Tries openclaw.json (JSON or JSON5) then config.json5.
 * Returns null if missing or unparseable.
 */
export async function readSourceOpenClawConfig(
  sourceConfigPath: string,
): Promise<Record<string, unknown> | null> {
  const base = resolveHome(sourceConfigPath).replace(/\/$/, "");
  const candidates = [
    path.join(base, OPENCLAW_JSON_FILENAME),
    path.join(base, OPENCLAW_CONFIG_JSON5),
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const raw = await readFile(filePath, "utf8");
    const parsed = await parseOpenClawConfig(raw, filePath);
    if (parsed && typeof parsed === "object") return parsed;
  }
  return null;
}

/**
 * Copy auth-profiles.json from source OpenClaw agents/main/agent to parallel dir
 * so the platform instance (18790) can use the same model API keys (e.g. Anthropic).
 */
export async function copyMainAgentAuth(
  sourceConfigPath: string,
  parallelConfigPath: string,
): Promise<boolean> {
  const srcBase = resolveHome(sourceConfigPath).replace(/\/$/, "");
  const dstBase = resolveHome(parallelConfigPath).replace(/\/$/, "");
  const srcPath = path.join(srcBase, MAIN_AGENT_AUTH_RELATIVE);
  const dstPath = path.join(dstBase, MAIN_AGENT_AUTH_RELATIVE);
  if (!existsSync(srcPath)) return false;
  await mkdir(path.dirname(dstPath), { recursive: true });
  await copyFile(srcPath, dstPath);
  return true;
}

/**
 * Ensure ~/.aifuturecity/openclaw.json exists with gateway.port (and optional auth token) set.
 * When sourceConfigPath is provided, merges models/env/agents from source openclaw config and
 * copies agents/main/agent/auth-profiles.json so the platform instance has model API keys.
 * @param sourceConfigPath - If set, copy model/auth config and auth-profiles from here (e.g. ~/.openclaw).
 * @returns Path to openclaw.json and the token written (for spawn env OPENCLAW_GATEWAY_TOKEN when needed).
 */
export async function ensurePlatformOpenClawConfig(
  parallelConfigPath: string,
  port: number,
  platformToken?: string,
  sourceConfigPath?: string,
): Promise<{ openclawJsonPath: string; effectiveToken: string }> {
  const base = resolveHome(parallelConfigPath).replace(/\/$/, "");
  const openclawJsonPath = path.join(base, OPENCLAW_JSON_FILENAME);
  await mkdir(base, { recursive: true });

  const existingGateway = (existing: Record<string, unknown>) =>
    (existing.gateway as Record<string, unknown>) ?? {};
  const gatewayBase = { port, mode: "local" as const };
  const effectiveToken =
    platformToken != null && platformToken !== ""
      ? platformToken
      : randomBytes(20).toString("hex");
  const gatewayAuth = { auth: { token: effectiveToken } };

  let merged: Record<string, unknown>;
  try {
    const raw = await readFile(openclawJsonPath, "utf8");
    const existing = JSON.parse(raw) as Record<string, unknown>;
    const existingChannels = (existing.channels as Record<string, unknown>) ?? {};
    merged = {
      ...existing,
      gateway: { ...existingGateway(existing), ...gatewayBase, ...gatewayAuth },
      channels: {
        ...existingChannels,
        imessage: { ...(existingChannels.imessage as Record<string, unknown> ?? {}), enabled: false },
        feishu: { ...(existingChannels.feishu as Record<string, unknown> ?? {}), enabled: false },
      },
    };
  } catch {
    merged = {
      gateway: { ...gatewayBase, ...gatewayAuth },
      channels: {
        imessage: { enabled: false },
        feishu: { enabled: false },
      },
    };
  }

  if (sourceConfigPath) {
    const sourceResolved = resolveHome(sourceConfigPath).replace(/\/$/, "");
    const sourceConfig = await readSourceOpenClawConfig(sourceConfigPath);
    let didMerge = false;
    if (sourceConfig) {
      if (sourceConfig.models != null) {
        merged.models = sourceConfig.models;
        didMerge = true;
      }
      if (sourceConfig.env != null) {
        merged.env = sourceConfig.env;
        didMerge = true;
      }
      if (sourceConfig.agents != null) {
        merged.agents = {
          ...(merged.agents as Record<string, unknown> | undefined),
          ...(sourceConfig.agents as Record<string, unknown>),
        };
        didMerge = true;
      }
    }
    if (didMerge) {
      console.log(
        "[aifc-sync] Merged models/env/agents from " + sourceResolved + " into platform openclaw.json",
      );
    }
    const copied = await copyMainAgentAuth(sourceConfigPath, parallelConfigPath);
    if (copied) {
      console.log(
        "[aifc-sync] Copied " +
          MAIN_AGENT_AUTH_RELATIVE +
          " from source to platform dir (model API keys will be used by training)",
      );
    } else {
      console.warn(
        "[aifc-sync] No " +
          MAIN_AGENT_AUTH_RELATIVE +
          " in source; platform instance may report missing API key. Run openclaw agents add main or copy auth-profiles.json to " +
          path.join(resolveHome(parallelConfigPath), MAIN_AGENT_AUTH_RELATIVE),
      );
    }
  }

  // Always force literal token (never ${OPENCLAW_GATEWAY_TOKEN}) so OpenClaw can start without requiring the env var
  merged.gateway = {
    ...(merged.gateway as Record<string, unknown> ?? {}),
    port: gatewayBase.port,
    mode: gatewayBase.mode,
    auth: { token: effectiveToken },
  };

  await writeFile(openclawJsonPath, JSON.stringify(merged, null, 2), "utf8");
  return { openclawJsonPath, effectiveToken };
}

/**
 * Read gateway.auth.token from the platform OpenClaw config (e.g. ~/.aifuturecity/openclaw.json).
 * OpenClaw may overwrite or generate this token on startup; use this to show the actual token for OPENCLAW_PLATFORM_TOKEN.
 */
export async function readPlatformAuthToken(parallelConfigPath: string): Promise<string | null> {
  const base = resolveHome(parallelConfigPath).replace(/\/$/, "");
  const openclawJsonPath = path.join(base, OPENCLAW_JSON_FILENAME);
  try {
    const raw = await readFile(openclawJsonPath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const gateway = data?.gateway as Record<string, unknown> | undefined;
    const auth = gateway?.auth as Record<string, unknown> | undefined;
    const token = auth?.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
