import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadLocalEnvFiles(): void {
  const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const candidates = [path.join(baseDir, ".env.local"), path.join(baseDir, ".env")];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const content = readFileSync(candidate, "utf8");
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
