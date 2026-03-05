export type DeviceHeartbeat = {
  deviceId: string;
  cpuPercent?: number;
  memoryPercent?: number;
  capabilities?: string[];
  timestamp: number;
};

export type DeviceTask = {
  taskId: string;
  assistantId: string;
  workspaceId: string;
  prompt: string;
};

export interface DevicePlugin {
  id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendHeartbeat(payload: DeviceHeartbeat): Promise<void>;
  dispatchTask(task: DeviceTask): Promise<unknown>;
}
