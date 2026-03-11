import type { ISessionStore } from "../sessions/session-store.js";

export function createWorkspaceMethods(deps: { sessions: ISessionStore }) {
  return {
    "workspace.list": async () => ({
      sessions: await deps.sessions.list(),
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
