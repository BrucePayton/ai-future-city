export type AIFutureCityPluginConfig = {
  deviceId: string;
  platformUrl: string;
  platformToken: string;
  defaultAgentId?: string;
  heartbeatIntervalMs?: number;
  pluginVersion?: string;
  deviceType?: string;
};

export type RunAgentParams = {
  message: string;
  agentId?: string;
  sessionKey: string;
  idempotencyKey: string;
};

export type OpenClawPluginApi = {
  config: AIFutureCityPluginConfig;
  runAgent(params: RunAgentParams): Promise<unknown>;
  getSystemMetrics?(): Promise<Record<string, unknown>>;
  logger?: {
    info(message: string, extra?: Record<string, unknown>): void;
    warn(message: string, extra?: Record<string, unknown>): void;
    error(message: string, extra?: Record<string, unknown>): void;
  };
};

export type PlatformConnectFrame = {
  type: "connect";
  deviceId: string;
  token: string;
  signature?: string;
  signedAt?: number;
  clientInfo: {
    version: string;
    deviceType: string;
  };
};

export type PlatformRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type PlatformResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type PlatformEventFrame = {
  type: "event";
  event: string;
  data?: Record<string, unknown>;
};

export type PlatformFrame =
  | PlatformConnectFrame
  | PlatformRequestFrame
  | PlatformResponseFrame
  | PlatformEventFrame;

export type PlatformOutboundMessage = {
  id: string;
  text: string;
  sessionId: string;
  agentId?: string;
};

export type GatewayStartHandle = {
  stop?: () => Promise<void> | void;
};

export type ChannelPlugin = {
  id: string;
  meta: {
    name: string;
    description: string;
  };
  capabilities: {
    inbound: boolean;
    outbound: boolean;
  };
  gateway?: {
    onStart(api: OpenClawPluginApi): Promise<GatewayStartHandle | void>;
  };
  outbound?: {
    send(api: OpenClawPluginApi, message: PlatformOutboundMessage): Promise<unknown>;
  };
};
