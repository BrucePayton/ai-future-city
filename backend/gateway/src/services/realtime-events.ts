/**
 * Realtime Events Service - WebSocket 实时事件推送
 * 支持任务状态变更、抢单通知、进度更新等
 */

import { WebSocketServer } from "ws";

// 使用 any 类型避免与 ws 库版本不兼容问题
type AnyWebSocket = any;

/**
 * 事件类型
 */
export type RealtimeEventType =
  | "task.created"
  | "task.updated"
  | "task.claimed"
  | "task.assigned"
  | "task.completed"
  | "task.cancelled"
  | "task.matched"
  | "team.member_joined"
  | "team.member_left"
  | "team.invited"
  | "order.created"
  | "order.paid"
  | "order.completed"
  | "wallet.updated"
  | "notification";

export interface RealtimeEvent {
  type: RealtimeEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

/**
 * 实时事件服务
 */
export class RealtimeEventsService {
  private wss: WebSocketServer | null = null;
  private tenantClients = new Map<string, Set<AnyWebSocket>>();
  private globalClients = new Set<AnyWebSocket>();

  setWebSocketServer(wss: WebSocketServer): void {
    this.wss = wss;
  }

  /**
   * 客户端订阅租户事件
   */
  subscribe(ws: AnyWebSocket, tenantId?: string): void {
    if (tenantId) {
      let clients = this.tenantClients.get(tenantId);
      if (!clients) {
        clients = new Set();
        this.tenantClients.set(tenantId, clients);
      }
      clients.add(ws);
    } else {
      this.globalClients.add(ws);
    }
  }

  /**
   * 客户端取消订阅
   */
  unsubscribe(ws: AnyWebSocket): void {
    this.globalClients.delete(ws);

    for (const clients of this.tenantClients.values()) {
      clients.delete(ws);
    }
  }

  /**
   * 广播事件给所有客户端
   */
  broadcast(event: RealtimeEventType, payload: Record<string, unknown>): void {
    this.broadcastTo(event, payload, undefined);
  }

  /**
   * 广播事件给特定租户的客户端
   */
  broadcastTo(event: RealtimeEventType, payload: Record<string, unknown>, tenantId?: string): void {
    const message = JSON.stringify({
      type: "event",
      event,
      payload,
      timestamp: Date.now(),
    });

    // 发送给租户订阅者
    if (tenantId) {
      const clients = this.tenantClients.get(tenantId);
      if (clients) {
        for (const ws of clients) {
          this.send(ws, message);
        }
      }
    }

    // 发送给全局订阅者
    for (const ws of this.globalClients) {
      this.send(ws, message);
    }
  }

  /**
   * 发送给特定用户
   */
  sendToUser(userId: string, event: RealtimeEventType, payload: Record<string, unknown>): void {
    const message = JSON.stringify({
      type: "event",
      event,
      payload: { ...payload, userId },
      timestamp: Date.now(),
    });

    // 发送给全局订阅者（由客户端过滤）
    for (const ws of this.globalClients) {
      this.send(ws, message);
    }
  }

  /**
   * 发送任务创建事件
   */
  emitTaskCreated(tenantId: string, task: Record<string, unknown>): void {
    this.broadcastTo("task.created", { task }, tenantId);
  }

  /**
   * 发送任务状态更新事件
   */
  emitTaskUpdated(tenantId: string, task: Record<string, unknown>): void {
    this.broadcastTo("task.updated", { task }, tenantId);
  }

  /**
   * 发送抢单成功事件
   */
  emitTaskClaimed(tenantId: string, task: Record<string, unknown>, userId: string): void {
    this.broadcastTo("task.claimed", { task, userId }, tenantId);
  }

  /**
   * 发送任务匹配事件
   */
  emitTaskMatched(tenantId: string, task: Record<string, unknown>, candidates: Record<string, unknown>[]): void {
    this.broadcastTo("task.matched", { task, candidates }, tenantId);
  }

  /**
   * 发送团队邀请事件
   */
  emitTeamInvited(tenantId: string, teamId: string, userId: string): void {
    this.broadcastTo("team.invited", { teamId, userId }, tenantId);
  }

  /**
   * 发送订单支付事件
   */
  emitOrderPaid(tenantId: string, order: Record<string, unknown>): void {
    this.broadcastTo("order.paid", { order }, tenantId);
  }

  /**
   * 发送通知
   */
  emitNotification(tenantId: string, notification: { title: string; message: string; type: string }): void {
    this.broadcastTo("notification", { notification }, tenantId);
  }

  /**
   * 发送消息到 WebSocket
   */
  private send(ws: AnyWebSocket, message: string): void {
    if (ws && ws.readyState === ws.OPEN) {
      try {
        ws.send(message);
      } catch (error) {
        console.error("[RealtimeEvents] Failed to send message:", error);
      }
    }
  }
}

// 单例
export const realtimeEvents = new RealtimeEventsService();

/**
 * 创建事件中间件 - 在 HTTP handler 中触发事件
 */
export function createEventMiddleware(realtime: RealtimeEventsService = realtimeEvents) {
  return {
    /**
     * 任务变更后触发事件
     */
    onTaskChange(eventType: "created" | "updated" | "claimed" | "matched", tenantId: string, task: Record<string, unknown>) {
      const eventMap = {
        created: "task.created",
        updated: "task.updated",
        claimed: "task.claimed",
        matched: "task.matched",
      } as const;

      realtime.broadcastTo(eventMap[eventType], { task }, tenantId);
    },

    /**
     * 团队变更后触发事件
     */
    onTeamChange(eventType: "member_joined" | "member_left" | "invited", tenantId: string, team: Record<string, unknown>, userId?: string) {
      const eventMap = {
        member_joined: "team.member_joined",
        member_left: "team.member_left",
        invited: "team.invited",
      } as const;

      const payload = userId ? { team, userId } : { team };
      realtime.broadcastTo(eventMap[eventType], payload, tenantId);
    },

    /**
     * 订单变更后触发事件
     */
    onOrderChange(eventType: "created" | "paid" | "completed", tenantId: string, order: Record<string, unknown>) {
      const eventMap = {
        created: "order.created",
        paid: "order.paid",
        completed: "order.completed",
      } as const;

      realtime.broadcastTo(eventMap[eventType], { order }, tenantId);
    },
  };
}