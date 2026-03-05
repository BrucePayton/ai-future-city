export type RpcRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

export type RpcResponseFrame = {
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

export type RpcEventFrame = {
  type: "event";
  event: string;
  data?: unknown;
};

export type RpcFrame = RpcRequestFrame | RpcResponseFrame | RpcEventFrame;

export function isRpcRequestFrame(frame: unknown): frame is RpcRequestFrame {
  return Boolean(
    frame &&
      typeof frame === "object" &&
      (frame as { type?: unknown }).type === "req" &&
      typeof (frame as { id?: unknown }).id === "string" &&
      typeof (frame as { method?: unknown }).method === "string",
  );
}
