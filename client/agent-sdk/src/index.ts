import { AgentConnector } from "./connector.js";
import { buildHeartbeatPayload } from "./heartbeat.js";
import { detectHardwareCapabilities } from "./hardware/index.js";

const connector = new AgentConnector({
  gatewayUrl: process.env.AIFC_GATEWAY_URL ?? "ws://localhost:3001/ws",
  deviceId: process.env.AIFC_DEVICE_ID ?? "local-agent-sdk",
  token: process.env.AIFC_DEVICE_TOKEN,
});

console.log("Agent SDK scaffold ready", {
  connection: connector.describeConnection(),
  heartbeat: buildHeartbeatPayload(process.env.AIFC_DEVICE_ID ?? "local-agent-sdk"),
  hardware: detectHardwareCapabilities(),
});

export { AgentConnector } from "./connector.js";
export { buildHeartbeatPayload } from "./heartbeat.js";
export { runSandboxedTool } from "./sandbox.js";
export { detectHardwareCapabilities } from "./hardware/index.js";
