export type SessionRecord = {
  id: string;
  title: string;
  status: "active" | "idle";
};

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(seed: SessionRecord[] = []) {
    for (const session of seed) {
      this.sessions.set(session.id, session);
    }
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  create(title: string): SessionRecord {
    const id = `ws-${this.sessions.size + 1}`;
    const session = { id, title, status: "active" as const };
    this.sessions.set(id, session);
    return session;
  }
}
