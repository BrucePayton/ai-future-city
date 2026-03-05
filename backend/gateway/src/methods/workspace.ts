import type { SessionStore } from "../sessions/session-store.js";

export function createWorkspaceMethods(deps: { sessions: SessionStore }) {
  return {
    "workspace.list": async () => ({
      sessions: deps.sessions.list(),
    }),
    "workspace.create": async (params: unknown) => {
      const payload =
        params && typeof params === "object" ? (params as { title?: unknown }) : undefined;
      return deps.sessions.create(
        typeof payload?.title === "string" ? payload.title : "New collaboration workspace",
      );
    },
  };
}
