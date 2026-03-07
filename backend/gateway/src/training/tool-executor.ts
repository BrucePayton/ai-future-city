/**
 * B4: Tool executor interface for sandbox execution.
 * Contract: backend-training-todo.md B4
 */

import type { TestCase } from "./test-cases.js";
import { getTestCases } from "./test-cases.js";

export type ToolExecuteResult = {
  output: string;
  error?: string;
  durationMs: number;
};

export type ToolExecutor = {
  execute(toolId: string, input: unknown): Promise<ToolExecuteResult>;
};

/** Stub executor: no real sandbox, simulates based on test case expectations. */
export function createStubToolExecutor(): ToolExecutor {
  return {
    async execute(toolId: string, _input: unknown): Promise<ToolExecuteResult> {
      const start = Date.now();
      const cases = getTestCases(toolId);
      const tc = cases[0];
      const durationMs = Date.now() - start;
      if (!tc) {
        return {
          output: "",
          error: `工具 ${toolId} 暂无可用测试用例`,
          durationMs,
        };
      }
      const stubOutputs: Record<string, string> = {
        code_exec: "2",
        web_search: "[search result placeholder]",
        knowledge_search: "[]",
      };
      const output = stubOutputs[toolId] ?? "";
      return { output, durationMs };
    },
  };
}
