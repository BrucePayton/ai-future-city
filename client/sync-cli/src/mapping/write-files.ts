/**
 * Write mapped Markdown files to parallel path with atomic replace.
 */

import { writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AssistantConfigFull } from "../types.js";
import { MAPPERS } from "./config-to-md.js";

function resolveHome(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return home ? `${home}${p.slice(1)}` : p;
  }
  return p;
}

export type WriteResult = { ok: true } | { ok: false; error: string };

/**
 * Write all SOUL.md, IDENTITY.md, USER.md, AGENTS.md, TOOLS.md to parallelConfigPath.
 * Uses temp file + rename for atomicity.
 */
export async function writeConfigToParallelPath(
  parallelConfigPath: string,
  config: AssistantConfigFull,
): Promise<WriteResult> {
  const base = resolveHome(parallelConfigPath).replace(/\/$/, "");
  try {
    await mkdir(base, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `mkdir: ${msg}` };
  }

  for (const [filename, fn] of Object.entries(MAPPERS)) {
    const content = fn(config);
    const filePath = join(base, filename);
    const tmpPath = join(base, `.${filename}.tmp.${process.pid}`);
    try {
      await writeFile(tmpPath, content, "utf8");
      await rename(tmpPath, filePath);
    } catch (err) {
      try {
        await unlink(tmpPath).catch(() => {});
      } catch {
        // ignore
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `write ${filename}: ${msg}` };
    }
  }

  return { ok: true };
}
