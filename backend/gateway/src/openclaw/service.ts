import { randomUUID } from "node:crypto";

import { OpenClawAdapter } from "@aifc/client-openclaw-adapter";

type OpenClawServiceOptions = {
  enabled: boolean;
  url?: string;
  token?: string;
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

  async getStatus(): Promise<{
    enabled: boolean;
    connected: boolean;
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

    try {
      const adapter = await this.getAdapter();
      const hello = await adapter.connect();
      return {
        enabled: true,
        connected: adapter.connected,
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
    const adapter = await this.requireConnectedAdapter();
    return adapter.inspectGateway();
  }

  async listAgents(): Promise<unknown> {
    const adapter = await this.requireConnectedAdapter();
    return adapter.request("agents.list", {});
  }

  async dispatchTask(params: {
    prompt: string;
    workspaceId: string;
    assistantId?: string;
    taskId?: string;
  }): Promise<unknown> {
    const adapter = await this.requireConnectedAdapter();
    return adapter.dispatchTask({
      message: params.prompt,
      agentId: params.assistantId ?? this.options.defaultAgentId,
      workspaceId: params.workspaceId,
      taskId: params.taskId ?? randomUUID(),
      timeoutSeconds: 60,
    });
  }

  async sendChat(params: {
    sessionKey: string;
    message: string;
    idempotencyKey?: string;
  }): Promise<unknown> {
    const adapter = await this.requireConnectedAdapter();
    return adapter.sendChat({
      sessionKey: params.sessionKey,
      message: params.message,
      idempotencyKey: params.idempotencyKey ?? randomUUID(),
      completionTimeoutMs: 60_000,
    });
  }

  async disconnect(): Promise<void> {
    this.adapter?.disconnect();
    this.adapter = null;
  }

  private async requireConnectedAdapter(): Promise<OpenClawAdapter> {
    if (!this.options.enabled) {
      throw new Error("OpenClaw integration is not configured. Set OPENCLAW_LOCAL_URL and OPENCLAW_LOCAL_TOKEN.");
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
