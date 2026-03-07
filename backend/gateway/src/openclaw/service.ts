import { randomUUID } from "node:crypto";

import { OpenClawAdapter } from "@aifc/client-openclaw-adapter";

import type { InboundOpenClawRegistry } from "./inbound-registry.js";

type OpenClawServiceOptions = {
  enabled: boolean;
  url?: string;
  token?: string;
  inboundRegistry?: InboundOpenClawRegistry | null;
  assistantId: string;
  defaultAgentId: string;
  requestTimeoutMs: number;
};

export class OpenClawGatewayService {
  private adapter: OpenClawAdapter | null = null;

  constructor(private readonly options: OpenClawServiceOptions) {}

  isEnabled(): boolean {
    return this.options.enabled;
  }

  /** Prefer inbound connection when available (OpenClaw on user's PC connecting to gateway). */
  private get inbound(): InboundOpenClawRegistry | null {
    return this.options.inboundRegistry ?? null;
  }

  private get useInbound(): boolean {
    return Boolean(this.inbound?.connected);
  }

  async getStatus(): Promise<{
    enabled: boolean;
    connected: boolean;
    source?: "outbound" | "inbound";
    url?: string;
    assistantId: string;
    defaultAgentId: string;
    hello?: unknown;
    error?: string;
  }> {
    if (!this.options.enabled) {
      return {
        enabled: false,
        connected: false,
        assistantId: this.options.assistantId,
        defaultAgentId: this.options.defaultAgentId,
      };
    }

    if (this.useInbound) {
      const conn = this.inbound!.current;
      return {
        enabled: true,
        connected: true,
        source: "inbound",
        assistantId: conn!.assistantId,
        defaultAgentId: conn!.defaultAgentId,
        hello: { type: "inbound", registeredAt: conn!.registeredAt },
      };
    }

    try {
      const adapter = await this.getAdapter();
      const hello = await adapter.connect();
      return {
        enabled: true,
        connected: adapter.connected,
        source: "outbound",
        url: this.options.url,
        assistantId: this.options.assistantId,
        defaultAgentId: this.options.defaultAgentId,
        hello,
      };
    } catch (error) {
      return {
        enabled: true,
        connected: false,
        url: this.options.url,
        assistantId: this.options.assistantId,
        defaultAgentId: this.options.defaultAgentId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async inspect(): Promise<unknown> {
    if (this.useInbound) {
      const reg = this.inbound!;
      const timeout = this.options.requestTimeoutMs;
      const [agents, health] = await Promise.all([
        reg.request("agents.list", {}, timeout),
        reg.request("health", {}, timeout),
      ]);
      return { hello: { type: "inbound" }, agents, health };
    }
    const adapter = await this.requireOutboundAdapter();
    return adapter.inspectGateway();
  }

  async listAgents(): Promise<unknown> {
    if (this.useInbound) {
      return this.inbound!.request("agents.list", {}, this.options.requestTimeoutMs);
    }
    const adapter = await this.requireOutboundAdapter();
    return adapter.request("agents.list", {});
  }

  async dispatchTask(params: {
    prompt: string;
    workspaceId: string;
    assistantId?: string;
    taskId?: string;
  }): Promise<unknown> {
    const agentId = params.assistantId ?? this.options.defaultAgentId;
    const taskId = params.taskId ?? randomUUID();

    if (this.useInbound) {
      const conn = this.inbound!.current!;
      return this.inbound!.request(
        "agent",
        {
          message: params.prompt,
          agentId,
          sessionKey: params.workspaceId,
          idempotencyKey: taskId,
          timeout: 60,
        },
        this.options.requestTimeoutMs,
      );
    }
    const adapter = await this.requireOutboundAdapter();
    return adapter.dispatchTask({
      message: params.prompt,
      agentId,
      workspaceId: params.workspaceId,
      taskId,
      timeoutSeconds: 60,
    });
  }

  async sendChat(params: {
    sessionKey: string;
    message: string;
    idempotencyKey?: string;
  }): Promise<unknown> {
    if (this.useInbound) {
      return this.sendChatOverInbound(params);
    }
    const adapter = await this.requireOutboundAdapter();
    return adapter.sendChat({
      sessionKey: params.sessionKey,
      message: params.message,
      idempotencyKey: params.idempotencyKey ?? randomUUID(),
      completionTimeoutMs: 60_000,
    });
  }

  private async sendChatOverInbound(params: {
    sessionKey: string;
    message: string;
    idempotencyKey?: string;
  }): Promise<unknown> {
    const reg = this.inbound!;
    const key = params.idempotencyKey ?? randomUUID();
    const accepted = await reg.request<{ runId?: string }>(
      "chat.send",
      {
        sessionKey: params.sessionKey,
        message: params.message,
        idempotencyKey: key,
        deliver: false,
      },
      this.options.requestTimeoutMs,
    );

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unbind();
        reject(new Error("Inbound OpenClaw chat timed out"));
      }, 60_000);

      const unbind = reg.onEvent((frame) => {
        if (frame.event !== "chat") return;
        const data = frame.data as { state?: string; message?: unknown; sessionKey?: string } | undefined;
        if (!data || data.sessionKey !== params.sessionKey) return;
        if (data.state === "final") {
          clearTimeout(timeout);
          unbind();
          resolve(data.message);
        } else if (data.state === "aborted") {
          clearTimeout(timeout);
          unbind();
          reject(new Error("Chat aborted"));
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    this.adapter?.disconnect();
    this.adapter = null;
  }

  private async requireOutboundAdapter(): Promise<OpenClawAdapter> {
    if (!this.options.enabled) {
      throw new Error(
        "OpenClaw is not configured. Set OPENCLAW_LOCAL_URL and OPENCLAW_LOCAL_TOKEN, or use inbound (OPENCLAW_INBOUND_TOKEN) and connect a bridge.",
      );
    }
    if (this.useInbound) {
      throw new Error("OpenClaw inbound is connected; outbound adapter not used.");
    }
    const adapter = await this.getAdapter();
    await adapter.connect();
    return adapter;
  }

  private async getAdapter(): Promise<OpenClawAdapter> {
    if (!this.adapter) {
      this.adapter = new OpenClawAdapter({
        url: this.options.url ?? "",
        token: this.options.token ?? "",
        assistantId: this.options.assistantId,
        requestTimeoutMs: this.options.requestTimeoutMs,
      });
    }
    return this.adapter;
  }
}
