/**
 * Assistant config types and in-memory store.
 * Contract: backend-assistant-config-todo.md / frontend-api-contract.md
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

export type AssistantConfigPayload = {
  name?: string;
  persona?: PersonaConfig;
  tools?: ToolConfigItem[] | Array<{ id: string; requiresApproval?: boolean }>;
  constraints?: ConstraintConfigItem[];
  costControl?: CostControlConfig;
  /** Chat evaluation pass threshold (0-100), default 80 */
  chatEvaluatePassThreshold?: number;
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

const defaultPersona: PersonaConfig = {};
const defaultCostControl: CostControlConfig = {};

function defaultConfig(id: string, name: string): AssistantConfigFull {
  return {
    id,
    name,
    persona: { ...defaultPersona },
    tools: [],
    constraints: [],
    costControl: { ...defaultCostControl },
  };
}

function normalizeTools(
  tools: AssistantConfigPayload["tools"],
): ToolConfigItem[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((t) =>
    typeof t === "object" && t && "id" in t
      ? {
          id: String(t.id),
          name: "name" in t ? t.name : undefined,
          category: "category" in t ? t.category : undefined,
          requiresApproval: "requiresApproval" in t ? t.requiresApproval : false,
        }
      : { id: String(t), requiresApproval: false },
  );
}

function normalizeConstraints(
  constraints: AssistantConfigPayload["constraints"],
): ConstraintConfigItem[] {
  if (!Array.isArray(constraints)) return [];
  const severities = ["critical", "high", "medium", "low"] as const;
  return constraints
    .filter((c): c is ConstraintConfigItem => typeof c?.rule === "string")
    .map((c) => ({
      rule: c.rule,
      severity: severities.includes(c.severity) ? c.severity : "medium",
    }));
}

export class AssistantConfigStore {
  private readonly configs = new Map<string, AssistantConfigFull>();

  get(id: string): AssistantConfigFull | undefined {
    return this.configs.get(id);
  }

  /** Get config for assistant; returns default-shaped object if none stored (caller should set id/name from list). */
  getOrDefault(id: string, name: string): AssistantConfigFull {
    const existing = this.configs.get(id);
    if (existing) return { ...existing };
    return defaultConfig(id, name);
  }

  /** Partial update: merge payload into existing or create from defaults. */
  update(
    id: string,
    name: string,
    payload: AssistantConfigPayload,
  ): AssistantConfigFull {
    const current = this.getOrDefault(id, name);
    const updated: AssistantConfigFull = {
      id: current.id,
      name: payload.name !== undefined ? String(payload.name) : current.name,
      persona:
        payload.persona !== undefined
          ? { ...current.persona, ...payload.persona }
          : current.persona,
      tools:
        payload.tools !== undefined
          ? normalizeTools(payload.tools)
          : current.tools,
      constraints:
        payload.constraints !== undefined
          ? normalizeConstraints(payload.constraints)
          : current.constraints,
      costControl:
        payload.costControl !== undefined
          ? { ...current.costControl, ...payload.costControl }
          : current.costControl,
      chatEvaluatePassThreshold:
        payload.chatEvaluatePassThreshold !== undefined
          ? Math.min(100, Math.max(0, Number(payload.chatEvaluatePassThreshold) || 80))
          : current.chatEvaluatePassThreshold,
    };
    this.configs.set(id, updated);
    return updated;
  }

  /** Remove stored config for assistant id. */
  delete(id: string): void {
    this.configs.delete(id);
  }

  /** List all stored configs (for persistence). */
  list(): AssistantConfigFull[] {
    return [...this.configs.values()];
  }

  /** Replace all configs from snapshot (for persistence load). */
  loadFromSnapshot(configs: AssistantConfigFull[]): void {
    this.configs.clear();
    for (const c of configs) {
      this.configs.set(c.id, { ...c });
    }
  }
}
