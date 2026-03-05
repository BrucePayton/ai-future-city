export type WorkspaceDispatchInput = {
  workspaceId: string;
  prompt: string;
  primaryAssistantId?: string;
};

export function buildWorkspacePlan(input: WorkspaceDispatchInput) {
  return {
    workspaceId: input.workspaceId,
    prompt: input.prompt,
    planner: input.primaryAssistantId ?? "planner",
    executor: "executor",
    createdAt: Date.now(),
  };
}
