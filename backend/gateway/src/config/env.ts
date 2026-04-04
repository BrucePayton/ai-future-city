export type GatewayEnv = {
  port: number;
  wsPath: string;
  /** PostgreSQL connection URL. When set, assistants state is stored in PG. Otherwise defaults to SQLite (`AIFC_ASSISTANTS_SQLITE_PATH` or `data/assistants.sqlite`); set `AIFC_ASSISTANTS_USE_JSON=1` for legacy JSON file only. */
  databaseUrl?: string;
  nodeEnv: string;
  openClaw: {
    enabled: boolean;
    /** Outbound: gateway connects to OpenClaw (OPENCLAW_LOCAL_URL + token) */
    url?: string;
    token?: string;
    /** Optional outbound: platform-persona OpenClaw for training (OPENCLAW_PLATFORM_URL + token) */
    platformUrl?: string;
    platformToken?: string;
    /** Inbound: OpenClaw/bridge connects to gateway (token only) */
    inboundToken?: string;
    inboundWsPath: string;
    assistantId: string;
    defaultAgentId: string;
    requestTimeoutMs: number;
  };
  payment: {
    enabled: boolean;
    /** Escrow contract address */
    escrowContractAddress?: string;
    /** Private key for contract interactions (platform operator) */
    escrowPrivateKey?: string;
    /** RPC URL for blockchain */
    escrowRpcUrl?: string;
    /** Default commission rate (0.1 = 10%) */
    defaultCommissionRate: number;
  };
};

export function loadGatewayEnv(): GatewayEnv {
  const hasOutbound =
    Boolean(process.env.OPENCLAW_LOCAL_URL && process.env.OPENCLAW_LOCAL_TOKEN);
  const inboundToken = process.env.OPENCLAW_INBOUND_TOKEN ?? process.env.OPENCLAW_LOCAL_TOKEN;
  const hasInbound = Boolean(inboundToken);

  const paymentEnabled = Boolean(
    process.env.ESCROW_CONTRACT_ADDRESS &&
    process.env.ESCROW_PRIVATE_KEY &&
    process.env.ESCROW_RPC_URL
  );

  return {
    port: Number.parseInt(process.env.PORT ?? process.env.AIFC_GATEWAY_PORT ?? "3001", 10),
    databaseUrl: process.env.DATABASE_URL ?? undefined,
    wsPath: process.env.AIFC_GATEWAY_WS_PATH ?? "/ws",
    nodeEnv: process.env.NODE_ENV ?? "development",
    openClaw: {
      enabled: hasOutbound || hasInbound,
      url: process.env.OPENCLAW_LOCAL_URL,
      token: process.env.OPENCLAW_LOCAL_TOKEN,
      platformUrl: process.env.OPENCLAW_PLATFORM_URL,
      platformToken: process.env.OPENCLAW_PLATFORM_TOKEN,
      inboundToken: hasInbound ? inboundToken : undefined,
      inboundWsPath:
        process.env.OPENCLAW_INBOUND_WS_PATH ?? process.env.AIFC_OPENCLAW_INBOUND_WS_PATH ?? "/ws/openclaw-inbound",
      assistantId: process.env.OPENCLAW_GATEWAY_ASSISTANT_ID ?? "aifc-gateway",
      defaultAgentId: process.env.OPENCLAW_LOCAL_AGENT_ID ?? "default",
      requestTimeoutMs: Number.parseInt(process.env.OPENCLAW_REQUEST_TIMEOUT_MS ?? "20000", 10),
    },
    payment: {
      enabled: paymentEnabled,
      escrowContractAddress: process.env.ESCROW_CONTRACT_ADDRESS,
      escrowPrivateKey: process.env.ESCROW_PRIVATE_KEY,
      escrowRpcUrl: process.env.ESCROW_RPC_URL,
      defaultCommissionRate: Number.parseFloat(process.env.DEFAULT_COMMISSION_RATE ?? "0.1"),
    },
  };
}
