/**
 * Optional file persistence for assistants state (devices, configs, hiddenIds, delistedIds).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AssistantConfigFull } from "./assistant-config.js";
import type { RegisteredDevice } from "../devices/device-manager.js";

export type AssistantsState = {
  devices: RegisteredDevice[];
  configs: AssistantConfigFull[];
  hiddenIds: string[];
  delistedIds: string[];
};

const DEFAULT_PATH = "data/assistants.json";

/** Load state from file. Returns null if file does not exist or parse fails. */
export async function loadAssistantsState(
  path: string = DEFAULT_PATH,
): Promise<AssistantsState | null> {
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return null;
    const o = data as Record<string, unknown>;
    return {
      devices: Array.isArray(o.devices) ? (o.devices as RegisteredDevice[]) : [],
      configs: Array.isArray(o.configs) ? (o.configs as AssistantConfigFull[]) : [],
      hiddenIds: Array.isArray(o.hiddenIds) ? (o.hiddenIds as string[]) : [],
      delistedIds: Array.isArray(o.delistedIds) ? (o.delistedIds as string[]) : [],
    };
  } catch {
    return null;
  }
}

/** Save state to file. Creates directory if needed. */
export async function saveAssistantsState(
  state: AssistantsState,
  path: string = DEFAULT_PATH,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}
