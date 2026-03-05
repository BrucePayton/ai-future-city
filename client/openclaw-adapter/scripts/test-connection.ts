import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OpenClawAdapter } from "../src/client.js";

loadLocalEnv();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const url = readRequiredEnv("OPENCLAW_LOCAL_URL");
const token = readRequiredEnv("OPENCLAW_LOCAL_TOKEN");
const assistantId = process.env.OPENCLAW_LOCAL_ASSISTANT_ID ?? "local-dev-agent";
const agentId = process.env.OPENCLAW_LOCAL_AGENT_ID ?? "default";
const sessionKey = process.env.OPENCLAW_CHAT_SESSION_KEY ?? "test-workspace-001";
const toolName = process.env.OPENCLAW_TOOL_NAME?.trim();
const toolInput = parseJsonEnv(process.env.OPENCLAW_TOOL_INPUT_JSON, {});

const adapter = new OpenClawAdapter({
  url,
  token,
  assistantId,
  requestTimeoutMs: 20_000,
});

try {
  console.log(`Workspace: ${rootDir}`);
  console.log(`Connecting to ${url} ...`);

  const hello = await adapter.connect();
  printBlock("connect hello-ok", hello);

  const inspection = await adapter.inspectGateway(
    toolName
      ? {
          toolCall: {
            tool: toolName,
            input: toolInput,
          },
        }
      : {},
  );

  printBlock("agents.list", inspection.agents);
  printBlock("health", inspection.health);
  printBlock("usage.cost", inspection.usageCost);
  printBlock("config.get", summarizeConfig(inspection.config));

  if (inspection.toolCall !== undefined) {
    printBlock(`tools.invoke(${toolName})`, inspection.toolCall);
  } else {
    console.log("Skipping tools.invoke verification because OPENCLAW_TOOL_NAME is not set.");
  }

  const dispatchResult = await adapter.dispatchTask({
    message: "Hello from AIFutureCity Phase 0. Please introduce yourself briefly.",
    agentId,
    workspaceId: sessionKey,
    taskId: randomUUID(),
    timeoutSeconds: 60,
  });
  printBlock("agent dispatch", dispatchResult);

  console.log(`Streaming chat from session ${sessionKey} ...`);
  const streamed = await adapter.sendChat({
    sessionKey,
    message: "Reply with a short greeting so I can verify streaming output.",
    idempotencyKey: randomUUID(),
    completionTimeoutMs: 60_000,
    onDelta: (text) => {
      process.stdout.write(text);
    },
    onFinal: () => {
      process.stdout.write("\n");
    },
  });
  printBlock("chat final", streamed);
} finally {
  adapter.disconnect();
}

function summarizeConfig(config: unknown): unknown {
  if (!config || typeof config !== "object") {
    return config;
  }

  const snapshot = config as {
    hash?: unknown;
    config?: unknown;
  };

  const configPayload =
    snapshot.config && typeof snapshot.config === "object"
      ? (snapshot.config as {
          agents?: unknown;
          tools?: unknown;
          skills?: unknown;
          gateway?: unknown;
        })
      : undefined;

  return {
    hash: snapshot.hash,
    config: {
      agents: configPayload?.agents,
      tools: configPayload?.tools,
      skills: configPayload?.skills,
      gateway: configPayload?.gateway,
    },
  };
}

function printBlock(title: string, value: unknown): void {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseJsonEnv(input: string | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!input || input.trim().length === 0) {
    return fallback;
  }

  const parsed = JSON.parse(input) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OPENCLAW_TOOL_INPUT_JSON must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function loadLocalEnv(): void {
  const envFiles = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env.local"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  ];

  for (const envFile of envFiles) {
    if (!existsSync(envFile)) {
      continue;
    }

    const content = readFileSync(envFile, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const index = line.indexOf("=");
      if (index === -1) {
        continue;
      }

      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/gu, "");
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}
