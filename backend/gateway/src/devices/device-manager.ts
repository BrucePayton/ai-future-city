export type RegisteredDevice = {
  id: string;
  kind: "openclaw" | "sdk" | "pc" | "custom";
  status: "online" | "offline";
  lastSeenAt: number;
  /** Optional display name for UI */
  name?: string;
};

export class DeviceManager {
  private readonly devices = new Map<string, RegisteredDevice>();

  constructor(seed: RegisteredDevice[] = []) {
    for (const device of seed) {
      this.devices.set(device.id, device);
    }
  }

  get(id: string): RegisteredDevice | undefined {
    return this.devices.get(id);
  }

  upsert(device: RegisteredDevice): void {
    const existing = this.devices.get(device.id);
    this.devices.set(device.id, {
      ...existing,
      ...device,
      lastSeenAt: device.lastSeenAt ?? Date.now(),
    });
  }

  list(): RegisteredDevice[] {
    return [...this.devices.values()];
  }
}
