export type SessionRecord = {
  id: string;
  title: string;
  status: "active" | "idle";
};

/** Interface used by HTTP/WS (implemented by SessionStore and PG store). */
export type ISessionStore = {
  list(): Promise<SessionRecord[]>;
  create(title: string): Promise<SessionRecord>;
};

/** In-memory implementation. For PG-backed, use createPgSessionStore. */
export class SessionStore implements ISessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(seed: SessionRecord[] = []) {
    for (const session of seed) {
      this.sessions.set(session.id, session);
    }
  }

  async list(): Promise<SessionRecord[]> {
    return [...this.sessions.values()];
  }

  async create(title: string): Promise<SessionRecord> {
    const id = `ws-${this.sessions.size + 1}`;
    const session = { id, title, status: "active" as const };
    this.sessions.set(id, session);
    return session;
  }
}
