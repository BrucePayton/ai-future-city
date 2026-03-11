"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type HealthPayload = {
  ok: boolean;
  service: string;
  timestamp: number;
  openClaw?: {
    enabled: boolean;
    connected: boolean;
    url?: string;
    assistantId: string;
    defaultAgentId: string;
    error?: string;
  };
};

type WsLog = {
  id: string;
  direction: "in" | "out" | "system";
  message: string;
};

type RpcResponse = {
  type: "res";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

const gatewayHttpUrl =
  process.env.NEXT_PUBLIC_GATEWAY_HTTP_URL ?? "http://localhost:3001";
const gatewayWsUrl =
  process.env.NEXT_PUBLIC_GATEWAY_WS_URL ?? "ws://localhost:3001/ws";

export function GatewayDashboard() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastAgents, setLastAgents] = useState<unknown>(null);
  const [lastOpenClawStatus, setLastOpenClawStatus] = useState<unknown>(null);
  const [logs, setLogs] = useState<WsLog[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const requestIdRef = useRef(0);

  const wsLabel = useMemo(
    () => (connected ? "status-online" : "status-offline"),
    [connected],
  );

  useEffect(() => {
    void loadHealth();
  }, []);

  useEffect(() => {
    const socket = new WebSocket(gatewayWsUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setConnected(true);
      appendLog("system", `Connected to ${gatewayWsUrl}`);
    });

    socket.addEventListener("close", () => {
      setConnected(false);
      appendLog("system", "Gateway websocket disconnected");
    });

    socket.addEventListener("message", (event) => {
      appendLog("in", event.data);

      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      const frame = parsed as { type?: unknown; event?: unknown };
      if (frame.type === "event" && frame.event === "connect.challenge") {
        sendRpc("connect", {
          client: { id: "aifc-web", version: "0.1.0" },
        });
        return;
      }

      const response = parsed as RpcResponse;
      if (response.type !== "res" || !response.ok) {
        return;
      }

      if (response.id.startsWith("openclaw-status")) {
        setLastOpenClawStatus(response.result);
      }

      if (response.id.startsWith("agents-list")) {
        setLastAgents(response.result);
      }
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  function appendLog(direction: WsLog["direction"], message: string) {
    setLogs((current) => [
      {
        id: `${Date.now()}-${current.length}`,
        direction,
        message,
      },
      ...current,
    ].slice(0, 24));
  }

  function sendRpc(method: string, params?: unknown) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      appendLog("system", "WebSocket not connected");
      return;
    }

    const id = `${method.replace(/\W+/gu, "-")}-${++requestIdRef.current}`;
    const payload = JSON.stringify({
      type: "req",
      id,
      method,
      params,
    });

    appendLog("out", payload);
    socketRef.current.send(payload);
  }

  async function loadHealth() {
    try {
      const response = await fetch(`${gatewayHttpUrl}/healthz`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as HealthPayload;
      setHealth(payload);
      setHealthError(null);
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="page-shell">
      <section className="hero">
        <h1>AIFutureCity Platform Console</h1>
        <p>
          现在前端不再只是静态骨架，而是一个真正的 Next.js 应用，直接读取
          `apps/gateway` 的健康检查和 WebSocket RPC，并展示 OpenClaw 接入状态。
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Gateway Health</h2>
          <div className="metric">
            <span>HTTP endpoint</span>
            <span>{gatewayHttpUrl}/healthz</span>
          </div>
          <div className="metric">
            <span>WebSocket endpoint</span>
            <span>{gatewayWsUrl}</span>
          </div>
          <div className="metric">
            <span>Gateway service</span>
            <span className={health?.ok ? "status-online" : "status-offline"}>
              {health?.ok ? "healthy" : "unknown"}
            </span>
          </div>
          <div className="metric">
            <span>OpenClaw</span>
            <span className={health?.openClaw?.connected ? "status-online" : "status-offline"}>
              {health?.openClaw?.connected ? "connected" : "not connected"}
            </span>
          </div>
          {healthError ? <div className="terminal">{healthError}</div> : null}
          {health ? <div className="terminal">{JSON.stringify(health, null, 2)}</div> : null}
          <div className="actions">
            <button className="button" onClick={() => void loadHealth()}>
              Refresh health
            </button>
            <button
              className="button"
              onClick={() => sendRpc("openclaw.status")}
              disabled={!connected}
            >
              Query OpenClaw status
            </button>
          </div>
        </article>

        <article className="card">
          <h2>WebSocket Console</h2>
          <div className="metric">
            <span>Connection</span>
            <span className={wsLabel}>{connected ? "connected" : "offline"}</span>
          </div>
          <div className="actions">
            <button
              className="button"
              onClick={() => sendRpc("assistants.list")}
              disabled={!connected}
            >
              assistants.list
            </button>
            <button
              className="button"
              onClick={() => sendRpc("openclaw.agents.list")}
              disabled={!connected}
            >
              openclaw.agents.list
            </button>
            <button
              className="button"
              onClick={() =>
                sendRpc("tasks.dispatch", {
                  workspaceId: "workspace-demo",
                  prompt: "Hello from AIFutureCity web console.",
                })
              }
              disabled={!connected}
            >
              tasks.dispatch
            </button>
          </div>
          <div className="terminal">
            {logs.length === 0 ? "Waiting for websocket activity..." : null}
            {logs.map((entry) => `${entry.direction}> ${entry.message}`).join("\n")}
          </div>
        </article>

        <article className="card">
          <h2>Latest OpenClaw RPC</h2>
          <div className="terminal">
            {JSON.stringify(lastOpenClawStatus ?? { hint: "No OpenClaw RPC result yet." }, null, 2)}
          </div>
        </article>

        <article className="card">
          <h2>Latest assistants.list</h2>
          <div className="terminal">
            {JSON.stringify(lastAgents ?? { hint: "No assistants RPC result yet." }, null, 2)}
          </div>
        </article>
      </section>
    </div>
  );
}
