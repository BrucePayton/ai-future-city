export function buildHeartbeatPayload(deviceId: string) {
  return {
    deviceId,
    sentAt: Date.now(),
    cpuPercent: 0,
    memoryPercent: 0,
  };
}
