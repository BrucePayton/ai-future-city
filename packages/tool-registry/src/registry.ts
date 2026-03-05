export type ToolDefinition = {
  id: string;
  title: string;
  description: string;
  source: "platform" | "openclaw" | "mcp" | "custom";
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }
}

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    id: "web_search",
    title: "Web Search",
    description: "Search the web for current information.",
    source: "platform",
  });

  registry.register({
    id: "knowledge_search",
    title: "Knowledge Search",
    description: "Search the AIFutureCity knowledge base.",
    source: "platform",
  });

  return registry;
}
