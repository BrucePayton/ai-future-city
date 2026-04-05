import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import type {
  ChatEventPayload,
  ChatSendAccepted,
  ChatSendParams,
  DispatchTaskParams,
  GatewayEventFrame,
  GatewayFrame,
  GatewayHelloOk,
  GatewayInspectionOptions,
  GatewayInspectionResult,
  GatewayResponseFrame,
  CloudBackendConfig,
} from "./types.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
};

type HandshakeState = {
  started: boolean;
  timer: NodeJS.Timeout;
  resolve: (hello: GatewayHelloOk) => void;
  reject: (error: unknown) => void;
};

type EventListener = (event: GatewayEventFrame) => void;

/**
 * CloudBackend connects to the cloud-hosted OpenClaw service.
 * Uses API Key authentication instead of local token.
 */
export class CloudBackend {
  private ws: WebSocket | null = null;
  private hello: GatewayHelloOk | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventListeners = new Set<EventListener>();
  private handshake: HandshakeState | null = null;
  private connectPromise: Promise<GatewayHelloOk> | null = null;
  private readonly config: CloudBackendConfig;

  constructor(config: CloudBackendConfig) {
    this.config = config;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.hello !== null;
  }

  get helloPayload(): GatewayHelloOk | null {
    return this.hello;
  }

  async connect(): Promise<GatewayHelloOk> {
    if (this.connected && this.hello) {
      return this.hello;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    // Build WebSocket URL from baseUrl
    const wsUrl = this.buildWebSocketUrl();

    this.connectPromise = new Promise<GatewayHelloOk>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "X-Organization-Id": this.config.organizationId ?? "",
        },
      });
      this.ws = ws;
      this.hello = null;

      this.handshake = {
        started: false,
        timer: setTimeout(() => {
          this.failHandshake(new Error("Timed out waiting for cloud OpenClaw connect.challenge"));
        }, this.config.requestTimeoutMs ?? 15_000),
        resolve,
        reject,
      };

      ws.on("message", (raw) => {
        const text = typeof raw === "string" ? raw : raw.toString();
        this.handleRawMessage(text);
      });

      ws.on("close", (code, reason) => {
        const closeReason = reason.toString();
        const error = new Error(
          this.hello
            ? `Cloud OpenClaw WebSocket closed: ${code} ${closeReason}`.trim()
            : `Cloud handshake failed before connect completed: ${code} ${closeReason}`.trim(),
        );

        if (this.handshake) {
          this.failHandshake(error);
        }

        this.rejectPending(error);
        this.ws = null;
        this.hello = null;
      });

      ws.on("error", (error) => {
        if (this.handshake) {
          this.failHandshake(error);
        }
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  disconnect(code?: number, reason?: string): void {
    if (this.handshake) {
      this.failHandshake(new Error("Cloud OpenClaw connection closed by client"));
    }

    if (this.ws) {
      this.ws.close(code, reason);
      this.ws = null;
    }

    this.hello = null;
    this.rejectPending(new Error("Cloud OpenClaw connection closed"));
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  async request<T>(method: string, params: unknown = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Cloud OpenClaw is not connected");
    }

    const id = randomUUID();
    const timeoutMs = this.config.requestTimeoutMs ?? 15_000;

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Cloud OpenClaw request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });

    // Add auth headers to params for cloud
    const authParams = typeof params === "object" && params !== null
      ? { ...params, _auth: { apiKey: this.config.apiKey, organizationId: this.config.organizationId } }
      : params;

    this.ws.send(JSON.stringify({ type: "req", id, method, params: authParams }));
    return promise;
  }

  async dispatchTask(params: DispatchTaskParams): Promise<{ runId?: string; status?: string }> {
    return this.request("agent", {
      message: params.message,
      agentId: params.agentId ?? "default",
      sessionKey: params.workspaceId,
      idempotencyKey: params.taskId,
      timeout: params.timeoutSeconds ?? 300,
    });
  }

  async sendChat(params: ChatSendParams): Promise<unknown> {
    let activeRunId: string | undefined;

    return new Promise<unknown>(async (resolve, reject) => {
      const unsubscribe = this.onEvent((event) => {
        if (event.event !== "chat") {
          return;
        }

        const rawPayload = event.payload ?? (event as { data?: unknown }).data;
        const payload = rawPayload as ChatEventPayload | undefined;
        if (!payload || typeof payload !== "object") {
          return;
        }

        const sessionMatch = payload.sessionKey === params.sessionKey;
        const runMatch = Boolean(activeRunId && payload.runId && payload.runId === activeRunId);
        if (!sessionMatch && !runMatch) {
          return;
        }
        if (activeRunId && payload.runId && payload.runId !== activeRunId) {
          return;
        }

        if (payload.state === "delta") {
          const text = extractText(payload.message);
          if (text) {
            params.onDelta?.(text, payload);
          }
          return;
        }

        if (payload.state === "final") {
          cleanup();
          params.onFinal?.(payload.message, payload);
          resolve(payload.message);
          return;
        }

        if (payload.state === "aborted") {
          cleanup();
          reject(new Error(`Cloud OpenClaw chat run aborted${payload.runId ? `: ${payload.runId}` : ""}`));
        }
      });

      const timeout =
        typeof params.completionTimeoutMs === "number"
          ? setTimeout(() => {
              cleanup();
              reject(new Error("Timed out waiting for cloud chat final event"));
            }, params.completionTimeoutMs)
          : null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        unsubscribe();
      };

      try {
        const accepted = await this.request<ChatSendAccepted>("chat.send", {
          sessionKey: params.sessionKey,
          message: params.message,
          idempotencyKey: params.idempotencyKey,
          deliver: params.deliver ?? false,
        });

        activeRunId = accepted.runId;
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  async inspectGateway(
    options: GatewayInspectionOptions = {},
  ): Promise<GatewayInspectionResult> {
    const hello = this.hello ?? (await this.connect());
    const usageDays = options.usageDays ?? 7;

    const [agents, health, usageCost, config] = await Promise.all([
      this.request("agents.list", {}),
      this.request("health", {}),
      this.request("usage.cost", { days: usageDays }),
      this.request("config.get", {}),
    ]);

    const toolCall = options.toolCall
      ? await this.request("tools.invoke", {
          tool: options.toolCall.tool,
          input: options.toolCall.input ?? {},
        })
      : undefined;

    return {
      hello,
      agents,
      health,
      usageCost,
      config,
      ...(toolCall === undefined ? {} : { toolCall }),
    };
  }

  private buildWebSocketUrl(): string {
    const baseUrl = this.config.baseUrl.replace(/^http/, "ws");
    const path = "/ws/openclaw";
    return `${baseUrl}${path}`;
  }

  private handleRawMessage(raw: string): void {
    let parsed: GatewayFrame;

    try {
      parsed = JSON.parse(raw) as GatewayFrame;
    } catch {
      return;
    }

    if (parsed.type === "event") {
      this.handleEventFrame(parsed);
      return;
    }

    if (parsed.type === "res") {
      this.handleResponseFrame(parsed);
    }
  }

  private handleEventFrame(frame: GatewayEventFrame): void {
    if (frame.event === "connect.challenge" && this.handshake && !this.handshake.started) {
      const payload =
        frame.payload && typeof frame.payload === "object"
          ? (frame.payload as { nonce?: unknown })
          : undefined;
      const nonce = typeof payload?.nonce === "string" ? payload.nonce : "";
      this.handshake.started = true;

      void this.sendConnect(nonce)
        .then((hello) => {
          this.hello = hello;
          this.resolveHandshake(hello);
        })
        .catch((error) => {
          this.failHandshake(error);
        });

      return;
    }

    for (const listener of this.eventListeners) {
      listener(frame);
    }
  }

  private handleResponseFrame(frame: GatewayResponseFrame): void {
    const pending = this.pending.get(frame.id);
    if (!pending) {
      return;
    }

    this.pending.delete(frame.id);
    clearTimeout(pending.timer);

    if (frame.ok) {
      pending.resolve(frame.payload);
      return;
    }

    pending.reject(
      new Error(
        `${frame.error?.code ?? "CLOUD_OPENCLAW_REQUEST_FAILED"}: ${frame.error?.message ?? "Unknown error"}`,
      ),
    );
  }

  private async sendConnect(nonce: string): Promise<GatewayHelloOk> {
    return this.request<GatewayHelloOk>("connect", {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: `cloud-client-${this.config.organizationId ?? "default"}`,
        version: "0.2.0",
        platform: "cloud",
        mode: "backend",
        instanceId: this.config.assistantId ?? "default",
      },
      role: "operator",
      scopes: ["operator.admin"],
      device: undefined,
      caps: ["tool-events"],
      auth: {
        token: this.config.apiKey,
      },
      userAgent: "AIFutureCity-CloudBackend/0.2.0",
      locale: "zh-CN",
      nonce,
    });
  }

  private resolveHandshake(hello: GatewayHelloOk): void {
    if (!this.handshake) {
      return;
    }

    clearTimeout(this.handshake.timer);
    const current = this.handshake;
    this.handshake = null;
    current.resolve(hello);
  }

  private failHandshake(error: unknown): void {
    if (!this.handshake) {
      return;
    }

    clearTimeout(this.handshake.timer);
    const current = this.handshake;
    this.handshake = null;
    current.reject(error);
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function extractText(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }

  if (!message || typeof message !== "object") {
    return "";
  }

  const candidate = message as {
    content?: unknown;
    text?: unknown;
  };

  if (typeof candidate.text === "string") {
    return candidate.text;
  }

  const content = candidate.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return "";
        }

        const typedEntry = entry as { type?: unknown; text?: unknown };
        return typedEntry.type === "text" && typeof typedEntry.text === "string"
          ? typedEntry.text
          : "";
      })
      .join("");
  }

  return "";
}