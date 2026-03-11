/**
 * Single run: fetch config and write to parallel path.
 */

import type { SyncConfig } from "./types.js";
import { fetchAssistantConfig } from "./fetch-config.js";
import { writeConfigToParallelPath } from "./mapping/write-files.js";

export type RunOnceResult = { ok: true } | { ok: false; error: string };

export async function runOnce(config: SyncConfig): Promise<RunOnceResult> {
  const result = await fetchAssistantConfig(config.gatewayUrl, config.assistantId);
  if (!result.ok) {
    return {
      ok: false,
      error: result.status ? `HTTP ${result.status}: ${result.error}` : result.error,
    };
  }
  const { resolvePaths } = await import("./config.js");
  const { parallelConfigPath } = resolvePaths(config);
  const writeResult = await writeConfigToParallelPath(parallelConfigPath, result.config);
  if (!writeResult.ok) {
    return { ok: false, error: writeResult.error };
  }
  return { ok: true };
}
