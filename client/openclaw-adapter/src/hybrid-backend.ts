import { randomUUID } from "node:crypto";

import { OpenClawAdapter } from "./client.js";
import { CloudBackend } from "./cloud-backend.js";
import type {
  ChatEventPayload,
  ChatSendAccepted,
  ChatSendParams,
  DispatchTaskParams,
  GatewayEventFrame,
  GatewayHelloOk,
  GatewayInspectionOptions,
  GatewayInspectionResult,
  HybridBackendConfig,
  OpenClawClientConfig,
} from "./types.js";

/**
 * HybridBackend provides automatic failover between local and cloud backends.
 * In "auto" mode, it tries local first, then falls back to cloud if local is unavailable.
 */
export class HybridBackend {
  private localBackend: OpenClawAdapter | null = null;
  private cloudBackend: CloudBackend | null = null;
  private currentBackend: OpenClawAdapter | CloudBackend | null = null;
  private readonly config: HybridBackendConfig;

  constructor(config: HybridBackendConfig) {
    this.config = config;
    this.initializeBackends();
  }

  private initializeBackends(): void {
    // Initialize local backend if configured
    if (this.config.mode === "local" || this.config.mode === "auto") {
      if (this.config.local) {
        const localConfig: OpenClawClientConfig = {
          url: this.config.local.url,
          token: this.config.local.token,
          assistantId: this.config.local.assistantId,
        };
        this.localBackend = new OpenClawAdapter(localConfig);
      }
    }

    // Initialize cloud backend if configured
    if (this.config.mode === "cloud" || this.config.mode === "auto") {
      if (this.config.cloud) {
        this.cloudBackend = new CloudBackend(this.config.cloud);
      }
    }
  }

  get connected(): boolean {
    return this.currentBackend?.connected ?? false;
  }

  get helloPayload(): GatewayHelloOk | null {
    return this.currentBackend?.helloPayload ?? null;
  }

  get mode(): "local" | "cloud" {
    return this.currentBackend instanceof CloudBackend ? "cloud" : "local";
  }

  /**
   * Connect to the backend based on mode setting.
   * In "auto" mode, tries local first then cloud.
   */
  async connect(): Promise<GatewayHelloOk> {
    if (this.config.mode === "cloud" && this.cloudBackend) {
      this.currentBackend = this.cloudBackend;
      return this.cloudBackend.connect();
    }

    if (this.config.mode === "local" && this.localBackend) {
      this.currentBackend = this.localBackend;
      return this.localBackend.connect();
    }

    // Auto mode: try local first, then cloud
    if (this.localBackend) {
      try {
        this.currentBackend = this.localBackend;
        return await this.localBackend.connect();
      } catch {
        // Local failed, try cloud
        if (this.cloudBackend) {
          try {
            this.currentBackend = this.cloudBackend;
            return await this.cloudBackend.connect();
          } catch {
            // Cloud also failed, throw original error
            throw new Error("Both local and cloud backends are unavailable");
          }
        }
        throw new Error("Local backend failed and no cloud backend configured");
      }
    }

    if (this.cloudBackend) {
      this.currentBackend = this.cloudBackend;
      return this.cloudBackend.connect();
    }

    throw new Error("No backend configured");
  }

  /**
   * Disconnect from current backend
   */
  disconnect(code?: number, reason?: string): void {
    this.localBackend?.disconnect(code, reason);
    this.cloudBackend?.disconnect(code, reason);
    this.currentBackend = null;
  }

  /**
   * Add event listener to current backend
   */
  onEvent(listener: (event: GatewayEventFrame) => void): () => void {
    const unsubscribeLocal = this.localBackend?.onEvent(listener) ?? (() => {});
    const unsubscribeCloud = this.cloudBackend?.onEvent(listener) ?? (() => {});
    return () => {
      unsubscribeLocal();
      unsubscribeCloud();
    };
  }

  /**
   * Send request to current backend
   */
  async request<T>(method: string, params: unknown = {}): Promise<T> {
    if (!this.currentBackend) {
      throw new Error("No backend connected");
    }
    return this.currentBackend.request(method, params);
  }

  /**
   * Dispatch task to current backend
   */
  async dispatchTask(params: DispatchTaskParams): Promise<{ runId?: string; status?: string }> {
    if (!this.currentBackend) {
      throw new Error("No backend connected");
    }
    return this.currentBackend.dispatchTask(params);
  }

  /**
   * Send chat message to current backend
   */
  async sendChat(params: ChatSendParams): Promise<unknown> {
    if (!this.currentBackend) {
      throw new Error("No backend connected");
    }
    return this.currentBackend.sendChat(params);
  }

  /**
   * Inspect gateway status on current backend
   */
  async inspectGateway(options: GatewayInspectionOptions = {}): Promise<GatewayInspectionResult> {
    if (!this.currentBackend) {
      throw new Error("No backend connected");
    }
    return this.currentBackend.inspectGateway(options);
  }

  /**
   * Get available backends info
   */
  getBackendInfo(): { local: boolean; cloud: boolean; current: "local" | "cloud" | null } {
    return {
      local: this.localBackend !== null,
      cloud: this.cloudBackend !== null,
      current: this.currentBackend instanceof CloudBackend ? "cloud" : this.currentBackend instanceof OpenClawAdapter ? "local" : null,
    };
  }

  /**
   * Switch to a specific backend
   */
  async switchTo(mode: "local" | "cloud"): Promise<GatewayHelloOk> {
    if (mode === "local" && this.localBackend) {
      this.currentBackend = this.localBackend;
      return this.localBackend.connect();
    }

    if (mode === "cloud" && this.cloudBackend) {
      this.currentBackend = this.cloudBackend;
      return this.cloudBackend.connect();
    }

    throw new Error(`Backend ${mode} is not configured`);
  }
}

/**
 * Create HybridBackend from gateway env config
 */
export function createHybridBackend(
  localConfig?: { url: string; token: string; assistantId: string },
  cloudConfig?: { baseUrl: string; apiKey: string; organizationId?: string },
  mode: "local" | "cloud" | "hybrid" = "hybrid",
): HybridBackend | null {
  if (!localConfig && !cloudConfig) {
    return null;
  }

  const config: HybridBackendConfig = {
    mode: mode === "hybrid" ? "auto" : mode,
    local: localConfig,
    cloud: cloudConfig
      ? {
          baseUrl: cloudConfig.baseUrl,
          apiKey: cloudConfig.apiKey,
          organizationId: cloudConfig.organizationId,
        }
      : undefined,
  };

  return new HybridBackend(config);
}