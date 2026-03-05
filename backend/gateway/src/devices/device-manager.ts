export type RegisteredDevice = {
  id: string;
  kind: "openclaw" | "sdk" | "custom";
  status: "online" | "offline";
  lastSeenAt: number;
};

export class DeviceManager {
  private readonly devices = new Map<string, RegisteredDevice>();

  constructor(seed: RegisteredDevice[] = []) {
    for (const device of seed) {
      this.devices.set(device.id, device);
    }
  }

  upsert(device: RegisteredDevice): void {
    this.devices.set(device.id, device);
  }

  list(): RegisteredDevice[] {
    return [...this.devices.values()];
  }
}
