export type GatewayEnv = {
  port: number;
  wsPath: string;
  nodeEnv: string;
  openClaw: {
    enabled: boolean;
    url?: string;
    token?: string;
    assistantId: string;
    defaultAgentId: string;
    requestTimeoutMs: number;
  };
};

export function loadGatewayEnv(): GatewayEnv {
  return {
    port: Number.parseInt(process.env.PORT ?? process.env.AIFC_GATEWAY_PORT ?? "3001", 10),
    wsPath: process.env.AIFC_GATEWAY_WS_PATH ?? "/ws",
    nodeEnv: process.env.NODE_ENV ?? "development",
    openClaw: {
      enabled: Boolean(process.env.OPENCLAW_LOCAL_URL && process.env.OPENCLAW_LOCAL_TOKEN),
      url: process.env.OPENCLAW_LOCAL_URL,
      token: process.env.OPENCLAW_LOCAL_TOKEN,
      assistantId: process.env.OPENCLAW_GATEWAY_ASSISTANT_ID ?? "aifc-gateway",
      defaultAgentId: process.env.OPENCLAW_LOCAL_AGENT_ID ?? "default",
      requestTimeoutMs: Number.parseInt(process.env.OPENCLAW_REQUEST_TIMEOUT_MS ?? "20000", 10),
    },
  };
}
