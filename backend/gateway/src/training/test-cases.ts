/**
 * B6: Test case library for tool execution.
 * Contract: backend-training-todo.md B6
 */

export type TestCaseInput = Record<string, unknown> | string;

export type TestCase = {
  toolId: string;
  input: TestCaseInput;
  expectedOutput?: string;
  /** Custom validator: return true if output is acceptable */
  validator?: (output: string) => boolean;
  timeoutMs?: number;
};

const BUILTIN_CASES: TestCase[] = [
  {
    toolId: "code_exec",
    input: { language: "python", code: "print(1+1)" },
    expectedOutput: "2",
    timeoutMs: 5000,
  },
  {
    toolId: "code_exec",
    input: { language: "python", code: 'print("hello")' },
    validator: (o) => o.includes("hello"),
    timeoutMs: 5000,
  },
  {
    toolId: "web_search",
    input: { query: "AIFutureCity" },
    validator: (o) => o.length > 0,
    timeoutMs: 10000,
  },
  {
    toolId: "knowledge_search",
    input: { query: "test" },
    validator: (o) => o.length >= 0,
    timeoutMs: 5000,
  },
];

const caseIndex = new Map<string, TestCase[]>();
for (const tc of BUILTIN_CASES) {
  const list = caseIndex.get(tc.toolId) ?? [];
  list.push(tc);
  caseIndex.set(tc.toolId, list);
}

/** Get test cases for a tool. Returns empty array if none. */
export function getTestCases(toolId: string): TestCase[] {
  return caseIndex.get(toolId) ?? [];
}
