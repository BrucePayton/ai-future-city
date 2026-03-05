export type AssistantRecord = {
  id: string;
  name: string;
  provider: "openclaw" | "native" | "hybrid";
  status: "online" | "offline" | "unknown";
};

export type MarketplaceTask = {
  id: string;
  title: string;
  status: "open" | "claimed" | "done";
  reward?: string;
};

export type WorkspaceRecord = {
  id: string;
  title: string;
  participants: string[];
};
