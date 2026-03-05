import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OpenClawOpenAIProxy } from "../src/openai-proxy.js";

loadLocalEnv();

const baseUrl =
  process.env.OPENCLAW_BASE_URL?.trim() ||
  process.env.OPENCLAW_LOCAL_URL?.replace(/^ws/iu, "http") ||
  "";
const token = process.env.OPENCLAW_REST_TOKEN?.trim() || process.env.OPENCLAW_LOCAL_TOKEN?.trim() || "";
const agentId = process.env.OPENCLAW_LOCAL_AGENT_ID?.trim() || "default";
const sessionId = process.env.OPENCLAW_CHAT_SESSION_KEY?.trim() || `aifc-rest-${Date.now()}`;

if (!baseUrl) {
  throw new Error("Missing OPENCLAW_BASE_URL or OPENCLAW_LOCAL_URL");
}

if (!token) {
  throw new Error("Missing OPENCLAW_REST_TOKEN or OPENCLAW_LOCAL_TOKEN");
}

const proxy = new OpenClawOpenAIProxy(baseUrl, token);

console.log(`POST ${baseUrl}/v1/chat/completions`);

const text = await proxy.runTask(
  agentId,
  "Reply with a single sentence confirming the OpenAI-compatible endpoint works.",
  { sessionId },
);

console.log("\n=== non-stream ===");
console.log(text);

console.log("\n=== stream ===");
for await (const delta of proxy.runTaskStream(
  agentId,
  "Reply with a short streamed greeting.",
  `${sessionId}-stream`,
)) {
  process.stdout.write(delta);
}
process.stdout.write("\n");

function loadLocalEnv(): void {
  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  const envFiles = [
    path.resolve(baseDir, "../../../.env.local"),
    path.resolve(baseDir, "../../../.env"),
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

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/gu, "");
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}
