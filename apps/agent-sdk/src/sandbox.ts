export async function runSandboxedTool(toolName: string, input: Record<string, unknown>) {
  return {
    toolName,
    input,
    status: "not-implemented",
  };
}
