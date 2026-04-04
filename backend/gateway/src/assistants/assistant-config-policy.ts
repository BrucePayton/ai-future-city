/**
 * Apply assistant config to prompts and enforce constraints / cost policy.
 * Contract: backend-assistant-config-todo.md
 */

import type { AssistantConfigFull, ConstraintConfigItem } from "./assistant-config.js";

export function estimateTokensM(text: string): number {
  if (!text) return 0;
  return text.length / 4 / 1_000_000;
}

/** Known deny-tag rules: all patterns must match (content + intent). */
const KNOWN_DENY_RULES: Record<string, RegExp[]> = {
  "generate-malware": [
    /\b(generate|generating|create|creating|write|writing|build|building|compile|编写|生成|制作|开发|创建)\b/i,
    /\b(malware|ransomware|virus|trojan|backdoor|exploit|木马|病毒|勒索|后门|免杀|恶意软件|蠕虫)\b/i,
  ],
  "expose-credentials": [
    /\b(password|passwd|secret|credential|apikey|api[_-]?key|private[_\s-]?key|token|bearer|私钥|密码|令牌|秘钥)\b/i,
    /\b(leak|expose|publish|share|post|dump|sell|透露|泄露|公开|出售|发送|贴出)\b/i,
  ],
};

/**
 * Deny-rule check on user-provided text (prompts, chat messages).
 * Unknown rule slugs: hyphen/underscore segments; require multiple hits when possible.
 */
export function contentViolatesDenyConstraints(
  text: string,
  constraints: ConstraintConfigItem[] | undefined,
): { violated: boolean; rule?: string; severity?: string } {
  if (!constraints?.length || !text.trim()) return { violated: false };

  const lower = text.toLowerCase();
  for (const c of constraints) {
    const rule = c.rule?.trim();
    if (!rule) continue;

    const patterns = KNOWN_DENY_RULES[rule];
    if (patterns) {
      if (patterns.every((re) => re.test(text))) {
        return { violated: true, rule, severity: c.severity };
      }
      continue;
    }

    const segments = rule
      .toLowerCase()
      .split(/[-_\s]+/)
      .filter((s) => s.length >= 3);
    if (segments.length >= 2) {
      const hits = segments.filter((s) => lower.includes(s));
      if (hits.length >= 2) {
        return { violated: true, rule, severity: c.severity };
      }
    } else if (segments.length === 1 && segments[0].length >= 4 && lower.includes(segments[0])) {
      return { violated: true, rule, severity: c.severity };
    }
  }
  return { violated: false };
}

export function costMonthlyLimitBlocks(config: AssistantConfigFull): {
  blocked: boolean;
  reason?: string;
} {
  const { monthlyTokenLimitM, tokenUsedThisMonthM } = config.costControl;
  if (
    typeof monthlyTokenLimitM === "number" &&
    monthlyTokenLimitM > 0 &&
    typeof tokenUsedThisMonthM === "number" &&
    tokenUsedThisMonthM >= monthlyTokenLimitM
  ) {
    return { blocked: true, reason: "Monthly token limit reached for this assistant" };
  }
  return { blocked: false };
}

export function minAcceptPriceBlocks(
  config: AssistantConfigFull,
  taskPrice?: number,
): { blocked: boolean; reason?: string } {
  const min = config.costControl.minAcceptPrice;
  if (typeof min !== "number" || min <= 0 || typeof taskPrice !== "number") {
    return { blocked: false };
  }
  if (taskPrice < min) {
    return { blocked: true, reason: "Task price is below this assistant's minimum accept price" };
  }
  return { blocked: false };
}

export function buildPersonaSystemPrefix(config: AssistantConfigFull): string {
  const p = config.persona;
  const lines: string[] = [];
  if (p.role) lines.push(`Role: ${p.role}`);
  if (p.description) lines.push(`Description: ${p.description}`);
  if (p.coreResponsibilities?.length) {
    lines.push(`Core responsibilities:\n- ${p.coreResponsibilities.join("\n- ")}`);
  }
  if (p.skillTags?.length) lines.push(`Skills: ${p.skillTags.join(", ")}`);
  if (!lines.length) return "";
  return `[AIFutureCity assistant config]\n${lines.join("\n")}\n\n`;
}
