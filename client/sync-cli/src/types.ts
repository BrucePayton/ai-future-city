/**
 * Types matching gateway GET /api/assistants/:id/config response.
 * Contract: frontend-api-contract.md / backend-assistant-config-todo.md
 */

export type PersonaConfig = {
  role?: string;
  description?: string;
  coreResponsibilities?: string[];
  skillTags?: string[];
};

export type ToolConfigItem = {
  id: string;
  name?: string;
  category?: string;
  requiresApproval?: boolean;
};

export type ConstraintConfigItem = {
  rule: string;
  severity: "critical" | "high" | "medium" | "low";
};

export type CostControlConfig = {
  monthlyTokenLimitM?: number;
  tokenUsedThisMonthM?: number;
  costWarningETH?: number;
  minAcceptPrice?: number;
};

export type AssistantConfigFull = {
  id: string;
  name: string;
  persona: PersonaConfig;
  tools: ToolConfigItem[];
  constraints: ConstraintConfigItem[];
  costControl: CostControlConfig;
  chatEvaluatePassThreshold?: number;
};

export type SyncConfig = {
  gatewayUrl: string;
  assistantId: string;
  /** Local AI assistant config path (e.g. ~/.openclaw) - read-only, for detection */
  sourceConfigPath: string;
  /** Parallel config path to write (e.g. ~/.aifuturecity) */
  parallelConfigPath: string;
  /** Poll interval in ms */
  pollIntervalMs?: number;
  /** Source type for future multi-source support */
  source?: "openclaw" | "sdk" | "custom";
  /** When true, run sync will spawn OpenClaw with OPENCLAW_STATE_DIR=parallelConfigPath; exit sync-cli to stop it (no env restore needed) */
  launchOpenClawWithSync?: boolean;
  /** Command to run for OpenClaw (e.g. "openclaw" or "npx openclaw"). Used when launchOpenClawWithSync is true. */
  openclawCommand?: string;
  /** Port for the platform OpenClaw instance (default 18790). Used when launchOpenClawWithSync is true so it does not conflict with local :18789. */
  openclawPort?: number;
  /** When true, run will also start the Inbound Bridge so the assistant shows as online in the gateway. Requires OPENCLAW_INBOUND_TOKEN (or inboundToken in config) and local OpenClaw. */
  launchInboundBridgeWithSync?: boolean;
  /** Optional: token for gateway inbound register. If not set, OPENCLAW_INBOUND_TOKEN or OPENCLAW_LOCAL_TOKEN env is used. */
  inboundToken?: string;
};
