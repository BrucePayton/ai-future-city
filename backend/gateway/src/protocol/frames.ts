export type GatewayRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type GatewayEventFrame = {
  type: "event";
  event: string;
  data?: unknown;
};

export function isGatewayRequestFrame(frame: unknown): frame is GatewayRequestFrame {
  return Boolean(
    frame &&
      typeof frame === "object" &&
      (frame as { type?: unknown }).type === "req" &&
      typeof (frame as { id?: unknown }).id === "string" &&
      typeof (frame as { method?: unknown }).method === "string",
  );
}
