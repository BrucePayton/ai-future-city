import { createHash } from "node:crypto";

import WebSocket from "ws";

import type {
  AIFutureCityPluginConfig,
  PlatformConnectFrame,
  PlatformEventFrame,
  PlatformFrame,
  PlatformRequestFrame,
  PlatformResponseFrame,
} from "./types.js";

type PlatformMessageListener = (frame: PlatformFrame) => void | Promise<void>;

type PlatformWsClientOptions = {
  config: AIFutureCityPluginConfig;
};

export class PlatformWsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<PlatformMessageListener>();

  constructor(private readonly options: PlatformWsClientOptions) {}

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(this.options.config.platformUrl);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("Platform websocket was not created"));
        return;
      }

      this.ws.once("open", () => {
        this.send(this.buildConnectFrame());
        resolve();
      });

      this.ws.once("error", reject);
      this.ws.on("message", (raw) => {
        const text = typeof raw === "string" ? raw : raw.toString();
        this.handleRawMessage(text);
      });
    });
  }

  async close(): Promise<void> {
    if (!this.ws) {
      return;
    }

    await new Promise<void>((resolve) => {
      const socket = this.ws;
      if (!socket) {
        resolve();
        return;
      }

      socket.once("close", () => resolve());
      socket.close();
    });

    this.ws = null;
  }

  onMessage(listener: PlatformMessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  sendResponse(id: string, payload: { ok: boolean; result?: unknown; error?: PlatformResponseFrame["error"] }): void {
    this.send({
      type: "res",
      id,
      ok: payload.ok,
      ...(payload.result === undefined ? {} : { result: payload.result }),
      ...(payload.error === undefined ? {} : { error: payload.error }),
    });
  }

  sendEvent(event: string, data: Record<string, unknown>): void {
    const frame: PlatformEventFrame = {
      type: "event",
      event,
      data,
    };
    this.send(frame);
  }

  private buildConnectFrame(): PlatformConnectFrame {
    const signedAt = Date.now();
    const payload = `${this.options.config.deviceId}:${signedAt}:${this.options.config.platformToken}`;

    return {
      type: "connect",
      deviceId: this.options.config.deviceId,
      token: this.options.config.platformToken,
      signedAt,
      signature: createHash("sha256").update(payload).digest("hex"),
      clientInfo: {
        version: this.options.config.pluginVersion ?? "0.1.0",
        deviceType: this.options.config.deviceType ?? "openclaw",
      },
    };
  }

  private send(frame: PlatformFrame): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("AIFutureCity platform websocket is not connected");
    }

    this.ws.send(JSON.stringify(frame));
  }

  private handleRawMessage(raw: string): void {
    let parsed: PlatformFrame;

    try {
      parsed = JSON.parse(raw) as PlatformFrame;
    } catch {
      return;
    }

    for (const listener of this.listeners) {
      void listener(parsed);
    }
  }
}

export function isPlatformRequestFrame(frame: PlatformFrame): frame is PlatformRequestFrame {
  return frame.type === "req";
}
