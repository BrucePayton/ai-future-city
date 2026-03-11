import type { AssistantConfigFull } from "./types.js";

export type FetchConfigResult =
  | { ok: true; config: AssistantConfigFull }
  | { ok: false; status: number; error: string };

/**
 * Fetch assistant config from gateway GET /api/assistants/:id/config.
 */
export async function fetchAssistantConfig(
  gatewayUrl: string,
  assistantId: string,
): Promise<FetchConfigResult> {
  const base = gatewayUrl.replace(/\/$/, "");
  const url = `${base}/api/assistants/${encodeURIComponent(assistantId)}/config`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
    const detail = cause ? `${msg} (${cause})` : msg;
    return { ok: false, status: 0, error: `${detail}. URL: ${url}` };
  }
  if (!res.ok) {
    let error = res.statusText;
    try {
      const body = await res.json() as { error?: string };
      if (typeof body.error === "string") error = body.error;
    } catch {
      // ignore
    }
    return { ok: false, status: res.status, error };
  }
  let config: AssistantConfigFull;
  try {
    config = (await res.json()) as AssistantConfigFull;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: res.status, error: msg };
  }
  if (!config || typeof config.id !== "string") {
    return { ok: false, status: res.status, error: "Invalid config response" };
  }
  return { ok: true, config };
}
