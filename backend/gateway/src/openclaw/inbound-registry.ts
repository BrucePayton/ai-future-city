import { randomUUID } from "node:crypto";

import type WebSocket from "ws";

export type InboundConnection = {
  socket: WebSocket;
  assistantId: string;
  defaultAgentId: string;
  registeredAt: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type InboundEventFrame = { type: "event"; event: string; data?: unknown };

/**
 * Registry for OpenClaw "inbound" connections: a client (bridge on user's PC)
 * connects to the gateway and is used to forward requests to local OpenClaw.
 */
export class InboundOpenClawRegistry {
  private connection: InboundConnection | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private eventListeners = new Set<(frame: InboundEventFrame) => void>();

  /** Valid token(s) for register. One match is enough. */
  constructor(private readonly validTokens: Set<string>) {}

  get connected(): boolean {
    if (!this.connection) return false;
    return this.connection.socket.readyState === 1; // OPEN
  }

  get current(): InboundConnection | null {
    if (!this.connection || this.connection.socket.readyState !== 1) return null;
    return this.connection;
  }

  /**
   * Register an inbound connection. Token must match one of validTokens.
   * Returns error message if invalid.
   */
  register(
    socket: WebSocket,
    token: string,
    assistantId?: string,
    defaultAgentId?: string,
  ): { ok: true; assistantId: string } | { ok: false; error: string } {
    if (!this.validTokens.has(token)) {
      return { ok: false, error: "Invalid or missing token" };
    }

    this.clearConnection();
    this.connection = {
      socket,
      assistantId: assistantId ?? "aifc-gateway",
      defaultAgentId: defaultAgentId ?? "default",
      registeredAt: Date.now(),
    };

    socket.on("message", (raw) => this.handleMessage(raw));
    socket.on("close", () => this.clearConnection());
    socket.on("error", () => this.clearConnection());

    return { ok: true, assistantId: this.connection.assistantId };
  }

  /**
   * Send a request to the inbound connection and wait for response.
   * Methods match OpenClaw gateway protocol: agents.list, agent, chat.send, etc.
   */
  async request<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    const conn = this.current;
    if (!conn) {
      throw new Error("No inbound OpenClaw connection. Connect a bridge to /ws/openclaw-inbound.");
    }

    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Inbound OpenClaw request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });

      conn.socket.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  onEvent(listener: (frame: InboundEventFrame) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private handleMessage(raw: Buffer | ArrayBuffer | Buffer[]): void {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    let parsed: {
      type?: string;
      id?: string;
      ok?: boolean;
      payload?: unknown;
      error?: { message?: string };
      event?: string;
      data?: unknown;
    };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return;
    }

    if (parsed.type === "event") {
      for (const cb of this.eventListeners) {
        cb({
          type: "event",
          event: parsed.event ?? "",
          data: parsed.payload ?? parsed.data,
        });
      }
      return;
    }

    if (parsed.type !== "res" || typeof parsed.id !== "string") return;

    const pending = this.pending.get(parsed.id);
    if (!pending) return;

    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);

    if (parsed.ok) {
      pending.resolve(parsed.payload);
    } else {
      pending.reject(new Error(parsed.error?.message ?? "Inbound OpenClaw request failed"));
    }
  }

  private clearConnection(): void {
    if (this.connection) {
      this.connection.socket.removeAllListeners();
      try {
        this.connection.socket.terminate();
      } catch {
        // ignore
      }
      this.connection = null;
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Inbound OpenClaw connection closed"));
      this.pending.delete(id);
    }
  }
}
