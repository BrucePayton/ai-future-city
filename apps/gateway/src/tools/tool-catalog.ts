export type PlatformTool = {
  id: string;
  title: string;
  source: "platform" | "openclaw";
};

export function getDefaultPlatformTools(): PlatformTool[] {
  return [
    { id: "web_search", title: "Web Search", source: "platform" },
    { id: "knowledge_search", title: "Knowledge Search", source: "platform" },
    { id: "spawn_subagent", title: "Spawn Subagent", source: "platform" },
  ];
}
