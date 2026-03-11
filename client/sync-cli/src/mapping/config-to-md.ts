/**
 * Map AssistantConfigFull to OpenClaw-style Markdown file contents.
 */

import type { AssistantConfigFull } from "../types.js";

export function configToSoulMd(config: AssistantConfigFull): string {
  const { persona } = config;
  const lines: string[] = [];
  if (persona.role) {
    lines.push("# Role", "", persona.role, "");
  }
  if (persona.description) {
    lines.push("## Description", "", persona.description, "");
  }
  if (persona.coreResponsibilities?.length) {
    lines.push("## Core responsibilities", "");
    for (const r of persona.coreResponsibilities) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }
  if (persona.skillTags?.length) {
    lines.push("## Skills", "");
    lines.push(persona.skillTags.join(", "), "");
  }
  return lines.length ? lines.join("\n").trimEnd() + "\n" : "# AIFutureCity synced persona\n\n(Sync from platform; edit on the platform.)\n";
}

export function configToIdentityMd(config: AssistantConfigFull): string {
  const { name, persona } = config;
  const lines: string[] = ["# Identity", ""];
  lines.push("- **Name**: " + (name || config.id || "Assistant"));
  if (persona.role) {
    lines.push("- **Role**: " + persona.role);
  }
  lines.push("");
  return lines.join("\n");
}

export function configToUserMd(_config: AssistantConfigFull): string {
  return `# About you

(Synced from AIFutureCity platform. Customize on the platform or extend locally.)
`;
}

export function configToAgentsMd(_config: AssistantConfigFull): string {
  return `# Work style

(Synced from AIFutureCity platform. Follow platform persona and constraints.)
`;
}

export function configToToolsMd(config: AssistantConfigFull): string {
  const { tools, constraints } = config;
  const lines: string[] = ["# Tools & constraints", ""];
  if (tools?.length) {
    lines.push("## Tools", "");
    for (const t of tools) {
      const approval = t.requiresApproval ? " (requires approval)" : "";
      lines.push(`- **${t.name ?? t.id}** (\`${t.id}\`)${approval}`);
    }
    lines.push("");
  }
  if (constraints?.length) {
    lines.push("## Constraints", "");
    for (const c of constraints) {
      lines.push(`- [${c.severity}] ${c.rule}`);
    }
    lines.push("");
  }
  return lines.length > 2 ? lines.join("\n") : "# Tools & constraints\n\n(Synced from platform.)\n";
}

export const MAPPERS = {
  "SOUL.md": configToSoulMd,
  "IDENTITY.md": configToIdentityMd,
  "USER.md": configToUserMd,
  "AGENTS.md": configToAgentsMd,
  "TOOLS.md": configToToolsMd,
} as const;
