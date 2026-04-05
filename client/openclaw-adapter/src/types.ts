export type GatewayEventFrame = {
  type: "event";
  event: string;
  seq?: number;
  payload?: unknown;
  stateVersion?: {
    presence?: number;
    health?: number;
  };
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type GatewayRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

export type GatewayFrame = GatewayEventFrame | GatewayResponseFrame | GatewayRequestFrame;

export type GatewayHelloOk = {
  type: "hello-ok";
  protocol: number;
  server?: {
    version?: string;
    connId?: string;
  };
  features?: {
    methods?: string[];
    events?: string[];
  };
  snapshot?: unknown;
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
    issuedAtMs?: number;
  };
  policy?: {
    tickIntervalMs?: number;
  };
};

export type OpenClawClientConfig = {
  url: string;
  token: string;
  assistantId: string;
  clientId?: string;
  clientVersion?: string;
  clientPlatform?: string;
  clientMode?: string;
  userAgent?: string;
  locale?: string;
  role?: string;
  scopes?: string[];
  requestTimeoutMs?: number;
};

/** Cloud backend configuration for SaaS mode */
export type CloudBackendConfig = {
  /** Cloud API endpoint (e.g., https://api.aifuturecity.com) */
  baseUrl: string;
  /** User API Key for authentication */
  apiKey: string;
  /** Organization ID for multi-tenancy */
  organizationId?: string;
  /** Assistant ID to use */
  assistantId?: string;
  requestTimeoutMs?: number;
};

/** Hybrid backend configuration */
export type HybridBackendConfig = {
  mode: "local" | "cloud" | "auto";
  local?: {
    url: string;
    token: string;
    assistantId: string;
  };
  cloud?: CloudBackendConfig;
};

/** Backend type for OpenClaw adapter */
export type BackendType = "local" | "cloud";

export type DispatchTaskParams = {
  message: string;
  agentId?: string;
  workspaceId: string;
  taskId: string;
  timeoutSeconds?: number;
};

export type ChatEventPayload = {
  sessionKey?: string;
  runId?: string;
  state?: string;
  message?: unknown;
};

export type ChatSendParams = {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  deliver?: boolean;
  completionTimeoutMs?: number;
  onDelta?: (text: string, payload: ChatEventPayload) => void;
  onFinal?: (message: unknown, payload: ChatEventPayload) => void;
};

export type ChatSendAccepted = {
  runId?: string;
  status?: string;
};

export type GatewayInspectionOptions = {
  usageDays?: number;
  toolCall?: {
    tool: string;
    input?: Record<string, unknown>;
  };
};

export type GatewayInspectionResult = {
  hello: GatewayHelloOk;
  agents: unknown;
  health: unknown;
  usageCost: unknown;
  config: unknown;
  toolCall?: unknown;
};
