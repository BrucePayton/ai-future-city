import { startHeartbeatReporter } from "./heartbeat.js";
import { isPlatformRequestFrame, PlatformWsClient } from "./platform-ws.js";
import { createTaskDispatchHandler } from "./task-handler.js";
import type { ChannelPlugin } from "./types.js";
import type { OpenClawPluginApi } from "./types.js";

export function createAIFutureCityPlugin(): ChannelPlugin {
  return {
    id: "aifuturecity",
    meta: {
      name: "AIFutureCity",
      description: "AIFutureCity platform bridge for OpenClaw devices",
    },
    capabilities: {
      inbound: true,
      outbound: true,
    },
    gateway: {
      async onStart(api: OpenClawPluginApi) {
        const client = new PlatformWsClient({
          config: api.config,
        });

        await client.connect();

        api.logger?.info("AIFutureCity platform websocket connected", {
          url: api.config.platformUrl,
          deviceId: api.config.deviceId,
        });

        const handleTaskDispatch = createTaskDispatchHandler({
          api,
          client,
        });

        const unsubscribe = client.onMessage(async (frame) => {
          if (!isPlatformRequestFrame(frame)) {
            return;
          }

          await handleTaskDispatch(frame);
        });

        const stopHeartbeat = startHeartbeatReporter({
          api,
          client,
          intervalMs: api.config.heartbeatIntervalMs,
        });

        return {
          stop: async () => {
            unsubscribe();
            stopHeartbeat();
            await client.close();
          },
        };
      },
    },
    outbound: {
      async send(api, message) {
        return api.runAgent({
          message: message.text,
          agentId: message.agentId ?? api.config.defaultAgentId ?? "default",
          sessionKey: message.sessionId,
          idempotencyKey: message.id,
        });
      },
    },
  };
}

const aifuturecityPlugin = createAIFutureCityPlugin();

export default aifuturecityPlugin;
export type {
  AIFutureCityPluginConfig,
  ChannelPlugin,
  OpenClawPluginApi,
  PlatformEventFrame,
  PlatformFrame,
  PlatformOutboundMessage,
  PlatformRequestFrame,
  PlatformResponseFrame,
} from "./types.js";
