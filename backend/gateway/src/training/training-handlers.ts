/**
 * Training module handlers.
 * Contract: backend-training-todo.md
 */

import type { AssistantConfigFull, AssistantConfigStore } from "../assistants/assistant-config.js";
import type { TrainingProgressStore } from "./training-store.js";
import { getDefaultPlatformTools } from "../tools/tool-catalog.js";

// --- Types (from spec) ---

export type ToolListItem = {
  id: string;
  name: string;
  category: string;
  source: "native" | "mcp" | "skill";
};

export type ChatEvaluateReq = {
  messages: Array<{ role: string; content: string }>;
};

export type ChatEvaluateRes = {
  passed: boolean;
  score: number;
  suggestions: string[];
};

export type ExecTestReq = { toolId: string };
export type ExecTestRes = {
  toolId: string;
  toolName: string;
  passed: boolean;
  durationMs: number;
  error: string | null;
};

export type ExecInjectReq = {
  toolId: string;
  schema?: string;
  examples?: string[];
};

export type TaskAnalyzeReq = {
  taskDescription: string;
  taskType?: "dev" | "data" | "audit";
};
export type TaskAnalyzeRes = {
  summary: string;
  constraints: string[];
  deliverables: string[];
  subtasks: Array<{ id: string; description: string; dependsOn: string[] }>;
};

export type TaskChainReq = {
  taskId?: string;
  subtasks: Array<{ id: string; description: string }>;
};
export type TaskChainRes = {
  steps: Array<{
    subtaskId: string;
    toolId: string;
    toolName: string;
    inputHint: string;
  }>;
};

// --- Tool name/category mapping ---
const TOOL_DISPLAY: Record<string, { name: string; category: string }> = {
  code_exec: { name: "代码执行", category: "compute" },
  web_search: { name: "Web 搜索", category: "data" },
  knowledge_search: { name: "知识检索", category: "data" },
  spawn_subagent: { name: "子代理", category: "compute" },
  file_read_write: { name: "文件读写", category: "data" },
  image_analyze: { name: "图像分析", category: "vision" },
  blockchain_query: { name: "区块链查询", category: "blockchain" },
};

function getToolDisplay(id: string, configName?: string): { name: string; category: string } {
  const mapped = TOOL_DISPLAY[id];
  if (mapped) return mapped;
  // MCP tools: mcp_server:tool_name
  if (id.includes(":")) return { name: configName ?? id.split(":").pop() ?? id, category: "code" };
  return { name: configName ?? id, category: "compute" };
}

// --- B3: Tools list ---

export function getAssistantTools(
  assistantId: string,
  assistantConfig: AssistantConfigStore,
): ToolListItem[] {
  const config = assistantConfig.getOrDefault(assistantId, assistantId);
  const platformTools = getDefaultPlatformTools();
  const result = new Map<string, ToolListItem>();

  // Add assistant config tools
  for (const t of config.tools) {
    const { name, category } = getToolDisplay(t.id, t.name);
    result.set(t.id, {
      id: t.id,
      name: name,
      category: t.category ?? category,
      source: t.id.includes(":") ? "mcp" : "native",
    });
  }

  // Add platform tools not yet in result
  for (const t of platformTools) {
    if (result.has(t.id)) continue;
    const { name, category } = getToolDisplay(t.id);
    result.set(t.id, {
      id: t.id,
      name: name,
      category,
      source: "native",
    });
  }

  return [...result.values()];
}

// --- B1: Chat evaluate (rule-based, supports configurable threshold) ---

const DEFAULT_CHAT_PASS_THRESHOLD = 80;

export function evaluateChat(
  _assistantId: string,
  config: AssistantConfigFull,
  req: ChatEvaluateReq,
): ChatEvaluateRes {
  const messages = Array.isArray(req.messages) ? req.messages : [];
  const lastAssistant = messages.filter((m) => m?.role === "assistant").pop();
  const content = typeof lastAssistant?.content === "string" ? lastAssistant.content : "";

  if (!content.trim()) {
    return { passed: false, score: 0, suggestions: ["助手回复为空，无法评估"] };
  }

  const suggestions: string[] = [];
  let score = 70; // base

  // Length & structure
  if (content.length >= 20) score += 5;
  if (content.length >= 100) score += 5;
  if (content.length >= 200) score += 3;

  // Persona role
  const persona = config.persona;
  if (persona?.role) {
    const roleLower = persona.role.toLowerCase();
    const contentLower = content.toLowerCase();
    const roleKeywords = roleLower.slice(0, Math.min(15, roleLower.length)).split(/\s+/).filter(Boolean);
    const roleMatch = roleKeywords.some((kw) => kw.length >= 2 && contentLower.includes(kw));
    if (roleMatch) score += 8;
    else suggestions.push("回复未体现配置的角色设定");
  }

  // Persona description
  if (persona?.description) {
    const descFirst = persona.description.slice(0, 20).trim();
    if (descFirst.length >= 3 && content.toLowerCase().includes(descFirst.slice(0, 6).toLowerCase())) {
      score += 5;
    }
  }

  // Persona coreResponsibilities
  if (persona?.coreResponsibilities?.length) {
    const anyMatch = persona.coreResponsibilities.some(
      (r) => r.length >= 3 && content.includes(r.slice(0, Math.min(6, r.length))),
    );
    if (anyMatch) score += 5;
    else if (suggestions.length < 2) suggestions.push("建议在回复中体现职责范围");
  }

  // Constraints adherence: check if content does not violate constraints
  const constraints = config.constraints ?? [];
  for (const c of constraints) {
    if (!c.rule?.trim()) continue;
    const ruleLower = c.rule.toLowerCase();
    const forbiddenPatterns = [
      /不要\s*(透露|泄露|分享)/,
      /禁止\s*(透露|泄露|分享)/,
      /必须\s*(遵守|遵循)/,
    ];
    const isNegative = forbiddenPatterns.some((p) => p.test(ruleLower));
    if (isNegative) continue;
    const ruleKeywords = ruleLower.split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);
    const adheres = ruleKeywords.some((kw) => content.toLowerCase().includes(kw));
    if (adheres) score += 3;
    else if (c.severity === "critical" && suggestions.length < 3) {
      suggestions.push(`建议遵守约束：${c.rule.slice(0, 30)}`);
    }
  }

  score = Math.min(100, score);
  const threshold = config.chatEvaluatePassThreshold ?? DEFAULT_CHAT_PASS_THRESHOLD;
  const passed = score >= threshold;

  return { passed, score, suggestions: passed ? [] : suggestions };
}

// --- B4: Exec test (uses test cases + optional executor) ---

import { createStubToolExecutor } from "./tool-executor.js";
import { getTestCases } from "./test-cases.js";

const defaultExecutor = createStubToolExecutor();

export function executeToolTest(
  toolId: string,
  tools: ToolListItem[],
  executor: { execute(toolId: string, input: unknown): Promise<{ output: string; error?: string; durationMs: number }> } = defaultExecutor,
): Promise<ExecTestRes> {
  const tool = tools.find((t) => t.id === toolId) ?? { id: toolId, name: toolId, category: "compute", source: "native" as const };
  const testCases = getTestCases(toolId);
  const tc = testCases[0];

  if (!tc) {
    return Promise.resolve({
      toolId: tool.id,
      toolName: tool.name,
      passed: false,
      durationMs: 0,
      error: `工具 ${toolId} 暂无可用测试用例或沙箱未配置`,
    });
  }

  return executor.execute(toolId, tc.input).then((result) => {
    let passed = !result.error;
    if (passed && tc.expectedOutput !== undefined) {
      passed = result.output.trim().includes(tc.expectedOutput);
    }
    if (passed && tc.validator) {
      passed = tc.validator(result.output);
    }
    return {
      toolId: tool.id,
      toolName: tool.name,
      passed,
      durationMs: result.durationMs,
      error: passed ? null : result.error ?? "输出不符合预期",
    };
  });
}

// --- B5: Exec inject (store in memory for now; could extend assistant config) ---

const injectedToolHints = new Map<string, Map<string, { schema?: string; examples?: string[] }>>();

export function injectToolHints(
  assistantId: string,
  req: ExecInjectReq,
): void {
  let map = injectedToolHints.get(assistantId);
  if (!map) {
    map = new Map();
    injectedToolHints.set(assistantId, map);
  }
  map.set(req.toolId, { schema: req.schema, examples: req.examples });
}

// --- B7: Task analyze (rule-based, type templates) ---

const TASK_TYPE_PATTERNS: Record<string, RegExp[]> = {
  dev: [/开发|实现|编写|代码|python|javascript|js|typescript|单元测试|测试用例|计分|游戏/i],
  data: [/数据|分析|etl|可视化|报表|统计/i],
  audit: [/审计|合规|检查|review|评审/i],
};

const TASK_TYPE_TEMPLATES: Record<
  "dev" | "data" | "audit" | "generic",
  { constraints: string[]; deliverables: string[]; subtasks: Array<{ id: string; description: string; dependsOn: string[] }> }
> = {
  dev: {
    constraints: ["代码需通过单元测试", "遵循平台约束"],
    deliverables: ["可运行代码", "测试用例"],
    subtasks: [
      { id: "s1", description: "需求分析与技术方案", dependsOn: [] },
      { id: "s2", description: "核心逻辑实现", dependsOn: ["s1"] },
      { id: "s3", description: "单元测试与文档", dependsOn: ["s2"] },
    ],
  },
  data: {
    constraints: ["数据来源合规", "遵循平台约束"],
    deliverables: ["数据流水线或报表", "说明文档"],
    subtasks: [
      { id: "s1", description: "数据需求与来源分析", dependsOn: [] },
      { id: "s2", description: "数据处理与转换", dependsOn: ["s1"] },
      { id: "s3", description: "输出与验证", dependsOn: ["s2"] },
    ],
  },
  audit: {
    constraints: ["检查项完整", "遵循平台约束"],
    deliverables: ["审计报告", "问题清单"],
    subtasks: [
      { id: "s1", description: "范围与标准确认", dependsOn: [] },
      { id: "s2", description: "执行检查", dependsOn: ["s1"] },
      { id: "s3", description: "汇总与报告", dependsOn: ["s2"] },
    ],
  },
  generic: {
    constraints: ["代码需通过单元测试", "遵循平台约束"],
    deliverables: ["可运行代码", "测试用例"],
    subtasks: [
      { id: "s1", description: "需求分析与技术方案", dependsOn: [] },
      { id: "s2", description: "核心逻辑实现", dependsOn: ["s1"] },
      { id: "s3", description: "单元测试与文档", dependsOn: ["s2"] },
    ],
  },
};

function detectTaskType(desc: string, explicitType?: string): "dev" | "data" | "audit" | "generic" {
  if (explicitType && (explicitType === "dev" || explicitType === "data" || explicitType === "audit")) {
    return explicitType;
  }
  for (const [type, patterns] of Object.entries(TASK_TYPE_PATTERNS)) {
    if (patterns.some((p) => p.test(desc))) return type as "dev" | "data" | "audit";
  }
  return "generic";
}

function extractSummary(desc: string): string {
  const techMatch = desc.match(/(?:python|javascript|js|typescript|java|go|rust)\s*实现/i);
  const tech = techMatch ? techMatch[0] : "";
  const keywords = desc.replace(/\s+/g, " ").slice(0, 60).trim();
  return [tech, keywords].filter(Boolean).join(" ") || "未提供任务描述";
}

export function analyzeTask(req: TaskAnalyzeReq): TaskAnalyzeRes {
  const desc = typeof req.taskDescription === "string" ? req.taskDescription : "";
  const taskType = detectTaskType(desc, req.taskType);
  const template = TASK_TYPE_TEMPLATES[taskType];
  const summary = extractSummary(desc);

  return {
    summary,
    constraints: template.constraints,
    deliverables: template.deliverables,
    subtasks: template.subtasks,
  };
}

// --- B8: Task chain (rule-based tool mapping) ---

const DESC_TOOL_RULES: Array<{
  patterns: RegExp[];
  toolId: string;
  toolName: string;
  hint: string;
}> = [
  { patterns: [/搜索|查找|调研|了解|best practice|最佳实践/i], toolId: "web_search", toolName: "Web 搜索", hint: "查找相关最佳实践" },
  { patterns: [/知识|检索|知识库/i], toolId: "knowledge_search", toolName: "知识检索", hint: "检索知识库" },
  { patterns: [/代码|实现|执行|编写|运行|print|函数|class/i], toolId: "code_exec", toolName: "代码执行", hint: "实现核心逻辑" },
  { patterns: [/文件|读写|test_|测试文件|单元测试/i], toolId: "file_read_write", toolName: "文件读写", hint: "编写测试并执行" },
  { patterns: [/图像|图片|分析|vision/i], toolId: "image_analyze", toolName: "图像分析", hint: "分析图像" },
  { patterns: [/子代理|spawn|subagent/i], toolId: "spawn_subagent", toolName: "子代理", hint: "派发子任务" },
];

const TOOL_DEPENDENCY: Record<string, string[]> = {
  file_read_write: ["code_exec"],
};

function matchToolForDescription(desc: string, tools: ToolListItem[]): ToolListItem | null {
  const toolIds = new Set(tools.map((t) => t.id));
  for (const rule of DESC_TOOL_RULES) {
    if (rule.patterns.some((p) => p.test(desc)) && toolIds.has(rule.toolId)) {
      return tools.find((t) => t.id === rule.toolId) ?? null;
    }
  }
  return null;
}

export function generateTaskChain(
  req: TaskChainReq,
  tools: ToolListItem[],
): TaskChainRes {
  const subtasks = Array.isArray(req.subtasks) ? req.subtasks : [];
  const toolIds = new Set(tools.map((t) => t.id));
  const usedTools = new Set<string>();

  const steps = subtasks.map((st) => {
    const matched = matchToolForDescription(st.description, tools);
    if (matched) {
      usedTools.add(matched.id);
      const rule = DESC_TOOL_RULES.find((r) => r.toolId === matched.id);
      return {
        subtaskId: st.id,
        toolId: matched.id,
        toolName: matched.name,
        inputHint: rule?.hint ?? st.description,
      };
    }
    const fallback = tools.find((t) => t.id === "code_exec") ?? tools[0];
    return {
      subtaskId: st.id,
      toolId: fallback?.id ?? "code_exec",
      toolName: fallback?.name ?? "代码执行",
      inputHint: st.description,
    };
  });

  return { steps };
}
