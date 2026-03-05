export type TableDefinition = {
  name: string;
  columns: string[];
};

export const coreTables: TableDefinition[] = [
  { name: "assistants", columns: ["id", "owner_id", "device_type", "status"] },
  { name: "tasks", columns: ["id", "publisher_id", "status", "reward"] },
  { name: "workspace_sessions", columns: ["id", "task_id", "status", "created_at"] },
];
