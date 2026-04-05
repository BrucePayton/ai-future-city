import http from "node:http";

import type {
  AssistantConfigPayload,
  AssistantConfigStore,
} from "../assistants/assistant-config.js";
import {
  buildPersonaSystemPrefix,
  contentViolatesDenyConstraints,
  costMonthlyLimitBlocks,
  estimateTokensM,
} from "../assistants/assistant-config-policy.js";
import type { DeviceManager } from "../devices/device-manager.js";
import type { RegisteredDevice } from "../devices/device-manager.js";
import type { DelistedAssistantIds } from "../assistants/assistant-list-state.js";
import type { HiddenAssistantIds } from "../assistants/assistant-list-state.js";
import { getAssistantsList, getAssistantsListRaw } from "../methods/assistants.js";
import type { OpenClawGatewayService } from "../openclaw/service.js";
import type { ISessionStore } from "../sessions/session-store.js";
import type { ITrainingProgressStore } from "../training/training-store.js";
import type { ITrainingSessionStore } from "../training/training-session-store.js";
import {
  analyzeTask,
  evaluateChat,
  executeToolTest,
  generateTaskChain,
  getAssistantTools,
  injectToolHints,
} from "../training/training-handlers.js";
import type { PgPool } from "../db/client.js";
import { createMarketplaceMethods } from "../methods/marketplace.js";
import { createTenantMethods } from "../methods/tenants.js";
import { createMarketplaceTaskMethods } from "../methods/tasks.js";
import { createOpenClawClusterService } from "../services/openclaw-cluster.js";
import { createTeamTaskService } from "../services/team-task-service.js";
import { createTeamService } from "../services/team-service.js";
import { createTaskQueueService } from "../services/task-queue.js";

const ASSISTANT_CONFIG_PATH_RE = /^\/api\/assistants\/([^/]+)\/config$/;
const ASSISTANT_TOOLS_PATH_RE = /^\/api\/assistants\/([^/]+)\/tools$/;
const ASSISTANT_CONNECTION_PATH_RE = /^\/api\/assistants\/([^/]+)\/connection$/;
const ASSISTANT_TEST_CONNECTION_PATH_RE = /^\/api\/assistants\/([^/]+)\/test-connection$/;
const ASSISTANT_TRAINING_CHAT_SEND_RE = /^\/api\/assistants\/([^/]+)\/training\/chat\/send$/;
const ASSISTANT_TRAINING_CHAT_EVAL_RE = /^\/api\/assistants\/([^/]+)\/training\/chat\/evaluate$/;
const ASSISTANT_TRAINING_EXEC_TEST_RE = /^\/api\/assistants\/([^/]+)\/training\/exec\/test$/;
const ASSISTANT_TRAINING_EXEC_INJECT_RE = /^\/api\/assistants\/([^/]+)\/training\/exec\/inject$/;
const ASSISTANT_TRAINING_TASK_ANALYZE_RE = /^\/api\/assistants\/([^/]+)\/training\/task\/analyze$/;
const ASSISTANT_TRAINING_TASK_CHAIN_RE = /^\/api\/assistants\/([^/]+)\/training\/task\/chain$/;
const ASSISTANT_TRAINING_PROGRESS_RE = /^\/api\/assistants\/([^/]+)\/training\/progress$/;
const ASSISTANT_TASKS_RE = /^\/api\/assistants\/([^/]+)\/tasks$/;
const ASSISTANT_TRAINING_SESSIONS_RE = /^\/api\/assistants\/([^/]+)\/training\/sessions$/;
const ASSISTANT_TRAINING_SESSION_RE = /^\/api\/assistants\/([^/]+)\/training\/sessions\/([^/]+)$/;

export function createHttpServer(deps: {
  devices: DeviceManager;
  sessions: ISessionStore;
  openClaw: OpenClawGatewayService;
  assistantConfig: AssistantConfigStore;
  trainingProgress: ITrainingProgressStore;
  trainingSessions: ITrainingSessionStore;
  hiddenIds: HiddenAssistantIds;
  delistedIds: DelistedAssistantIds;
  pool?: PgPool;
  /** Optional: persist assistants state after mutations (e.g. to file). */
  persistAssistantsData?: () => void | Promise<void>;
}) {
  // 创建 marketplace 方法处理器
  let marketplaceHandlers: ReturnType<typeof createMarketplaceMethods> | null = null;
  let tenantHandlers: ReturnType<typeof createTenantMethods> | null = null;
  let taskHandlers: ReturnType<typeof createMarketplaceTaskMethods> | null = null;
  let openClawClusterHandlers: ReturnType<typeof createOpenClawClusterService> | null = null;
  let teamHandlers: ReturnType<typeof createTeamService> | null = null;
  let taskQueueHandlers: ReturnType<typeof createTaskQueueService> | null = null;
  let teamTaskHandlers: ReturnType<typeof createTeamTaskService> | null = null;

  if (deps.pool) {
    marketplaceHandlers = createMarketplaceMethods({ pool: deps.pool });
    tenantHandlers = createTenantMethods({ pool: deps.pool });
    taskHandlers = createMarketplaceTaskMethods({ pool: deps.pool });
    openClawClusterHandlers = createOpenClawClusterService({ pool: deps.pool });
    teamHandlers = createTeamService({ pool: deps.pool });
    taskQueueHandlers = createTaskQueueService({ pool: deps.pool });
    teamTaskHandlers = createTeamTaskService({ pool: deps.pool });
  }
  return http.createServer((req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/healthz") {
      void respondJson(res, 200, async () => ({
        ok: true,
        service: "gateway",
        timestamp: Date.now(),
        openClaw: await deps.openClaw.getStatus(),
      }));
      return;
    }

    if (req.url === "/api/overview") {
      void respondJson(res, 200, async () => ({
        devices: deps.devices.list(),
        sessions: await deps.sessions.list(),
        openClaw: await deps.openClaw.getStatus(),
      }));
      return;
    }

    if (req.url === "/api/openclaw/agents") {
      void respondJson(res, 200, async () => deps.openClaw.listAgents());
      return;
    }

    if (req.method === "POST" && req.url === "/api/openclaw/platform-token") {
      void respondJson(res, 200, async () => {
        const raw = await readRequestBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const token = typeof body?.token === "string" ? body.token : "";
        if (!token) return { ok: false, error: "Missing token" };
        return deps.openClaw.updatePlatformToken(token);
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/assistants") {
      void respondJson(res, 200, async () =>
        getAssistantsList({
          devices: deps.devices,
          openClaw: deps.openClaw,
          hiddenIds: deps.hiddenIds,
          delistedIds: deps.delistedIds,
        }),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/api/assistants/register") {
      void handleRegisterAssistant(req, res, deps);
      return;
    }

    const path = (req.url ?? "").split("?")[0];

    // GET /api/assistants/:id, DELETE /api/assistants/:id, PATCH /api/assistants/:id
    const assistantIdMatch = path.match(/^\/api\/assistants\/([^/]+)$/);
    if (assistantIdMatch) {
      const id = assistantIdMatch[1];
      if (req.method === "GET") {
        void handleGetAssistant(req, res, id, deps);
        return;
      }
      if (req.method === "DELETE") {
        void handleDeleteAssistant(req, res, id, deps);
        return;
      }
      if (req.method === "PATCH") {
        void handlePatchAssistant(req, res, id, deps);
        return;
      }
    }

    // B3: GET /api/assistants/:id/tools
    const toolsMatch = path.match(ASSISTANT_TOOLS_PATH_RE);
    if (toolsMatch && req.method === "GET") {
      void handleTrainingTools(req, res, toolsMatch[1], deps);
      return;
    }

    // Connection config: POST /api/assistants/:id/connection
    const connectionMatch = path.match(ASSISTANT_CONNECTION_PATH_RE);
    if (connectionMatch && req.method === "POST") {
      void handleConnection(req, res, connectionMatch[1], deps);
      return;
    }

    // Test connection: POST /api/assistants/:id/test-connection
    const testConnectionMatch = path.match(ASSISTANT_TEST_CONNECTION_PATH_RE);
    if (testConnectionMatch && req.method === "POST") {
      void handleTestConnection(req, res, testConnectionMatch[1], deps);
      return;
    }

    // TC: POST /api/assistants/:id/training/chat/send
    const chatSendMatch = path.match(ASSISTANT_TRAINING_CHAT_SEND_RE);
    if (chatSendMatch && req.method === "POST") {
      void handleTrainingChatSend(req, res, chatSendMatch[1], deps);
      return;
    }

    // B1: POST /api/assistants/:id/training/chat/evaluate
    const chatEvalMatch = path.match(ASSISTANT_TRAINING_CHAT_EVAL_RE);
    if (chatEvalMatch && req.method === "POST") {
      void handleChatEvaluate(req, res, chatEvalMatch[1], deps);
      return;
    }

    // B4: POST /api/assistants/:id/training/exec/test
    const execTestMatch = path.match(ASSISTANT_TRAINING_EXEC_TEST_RE);
    if (execTestMatch && req.method === "POST") {
      void handleExecTest(req, res, execTestMatch[1], deps);
      return;
    }

    // B5: POST /api/assistants/:id/training/exec/inject
    const execInjectMatch = path.match(ASSISTANT_TRAINING_EXEC_INJECT_RE);
    if (execInjectMatch && req.method === "POST") {
      void handleExecInject(req, res, execInjectMatch[1], deps);
      return;
    }

    // B7: POST /api/assistants/:id/training/task/analyze
    const taskAnalyzeMatch = path.match(ASSISTANT_TRAINING_TASK_ANALYZE_RE);
    if (taskAnalyzeMatch && req.method === "POST") {
      void handleTaskAnalyze(req, res, taskAnalyzeMatch[1], deps);
      return;
    }

    // B8: POST /api/assistants/:id/training/task/chain
    const taskChainMatch = path.match(ASSISTANT_TRAINING_TASK_CHAIN_RE);
    if (taskChainMatch && req.method === "POST") {
      void handleTaskChain(req, res, taskChainMatch[1], deps);
      return;
    }

    // B10: GET/POST /api/assistants/:id/training/progress
    const progressMatch = path.match(ASSISTANT_TRAINING_PROGRESS_RE);
    if (progressMatch) {
      if (req.method === "GET") {
        void handleGetTrainingProgress(req, res, progressMatch[1], deps);
        return;
      }
      if (req.method === "POST") {
        void handlePostTrainingProgress(req, res, progressMatch[1], deps);
        return;
      }
    }

    // B9: GET /api/assistants/:id/tasks
    const tasksMatch = path.match(ASSISTANT_TASKS_RE);
    if (tasksMatch && req.method === "GET") {
      void handleAssistantTasks(req, res, tasksMatch[1], deps);
      return;
    }

    // B11: POST /api/assistants/:id/training/sessions
    const sessionsMatch = path.match(ASSISTANT_TRAINING_SESSIONS_RE);
    if (sessionsMatch && req.method === "POST") {
      void handleCreateTrainingSession(req, res, sessionsMatch[1], deps);
      return;
    }

    // B11: GET /api/assistants/:id/training/sessions/:sessionId
    const sessionMatch = path.match(ASSISTANT_TRAINING_SESSION_RE);
    if (sessionMatch && req.method === "GET") {
      void handleGetTrainingSession(req, res, sessionMatch[1], sessionMatch[2], deps);
      return;
    }

    const configPathMatch = path.match(ASSISTANT_CONFIG_PATH_RE);
    if (configPathMatch) {
      const assistantId = configPathMatch[1];
      if (req.method === "GET") {
        void handleGetAssistantConfig(req, res, assistantId, deps);
        return;
      }
      if (req.method === "PATCH") {
        void handlePatchAssistantConfig(req, res, assistantId, deps);
        return;
      }
    }

    // ========================================
    // Marketplace API (技能交易平台)
    // ========================================

    if (marketplaceHandlers) {
      // Skills API - Create
      if (req.method === "POST" && req.url === "/api/skills") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["skills.create"](body);
        }, res);
        return;
      }

      // Skills API - List
      if (req.method === "GET" && req.url === "/api/skills") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["skills.list"](body || {});
        }, res);
        return;
      }

      // Skills API - Get by ID
      const skillIdMatch = req.url?.match(/^\/api\/skills\/([a-f0-9-]+)$/);
      if (skillIdMatch && marketplaceHandlers) {
        const skillId = skillIdMatch[1];
        if (req.method === "GET") {
          void respondJson(res, 200, async () => {
            return marketplaceHandlers!["skills.get"]({ id: skillId });
          });
          return;
        }
        if (req.method === "PATCH" || req.method === "PUT") {
          void handleJsonBody(req, async (body) => {
            return marketplaceHandlers!["skills.update"]({ id: skillId, ...body });
          }, res);
          return;
        }
        if (req.method === "DELETE") {
          void handleJsonBody(req, async () => {
            return marketplaceHandlers!["skills.setStatus"]({ id: skillId, status: "archived" });
          }, res);
          return;
        }
      }

      // Orders API - Create
      if (req.method === "POST" && req.url === "/api/orders") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["orders.create"](body);
        }, res);
        return;
      }

      // Orders API - Get by ID
      const orderIdMatch = req.url?.match(/^\/api\/orders\/([a-f0-9-]+)$/);
      if (orderIdMatch && marketplaceHandlers) {
        const orderId = orderIdMatch[1];
        if (req.method === "GET") {
          void respondJson(res, 200, async () => {
            return marketplaceHandlers!["orders.get"]({ id: orderId });
          });
          return;
        }
      }

      // Wallet API - Get balance
      if (req.method === "GET" && req.url?.startsWith("/api/wallet")) {
        const url = new URL(req.url, `http://localhost`);
        const userId = url.searchParams.get("userId");
        if (userId) {
          void respondJson(res, 200, async () => {
            return marketplaceHandlers!["wallet.get"]({ userId });
          });
          return;
        }
      }

      // Wallet API - Withdraw
      if (req.method === "POST" && req.url === "/api/wallet/withdraw") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["wallet.withdraw"](body);
        }, res);
        return;
      }

      // Reviews API - Create
      if (req.method === "POST" && req.url === "/api/reviews") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["reviews.create"](body);
        }, res);
        return;
      }

      // Payment API - Check enabled
      if (req.method === "GET" && req.url === "/api/payment/status") {
        void respondJson(res, 200, async () => {
          // Use type assertion to call the method with correct type
          const handler = marketplaceHandlers!["payment.isEnabled"] as () => Promise<unknown>;
          return handler();
        });
        return;
      }

      // Payment API - Create escrow
      if (req.method === "POST" && req.url === "/api/payment/escrow") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["payment.createEscrow"](body);
        }, res);
        return;
      }

      // Payment API - Fund escrow
      if (req.method === "POST" && req.url === "/api/payment/fund") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["payment.fund"](body);
        }, res);
        return;
      }

      // Payment API - Claim milestone
      if (req.method === "POST" && req.url === "/api/payment/claim") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["payment.claimMilestone"](body);
        }, res);
        return;
      }

      // Payment API - Release milestone
      if (req.method === "POST" && req.url === "/api/payment/release") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["payment.releaseMilestone"](body);
        }, res);
        return;
      }

      // Payment API - Get escrow status
      const escrowStatusMatch = req.url?.match(/^\/api\/payment\/escrow\/([a-f0-9-]+)$/);
      if (escrowStatusMatch && req.method === "GET") {
        const orderId = escrowStatusMatch[1];
        void respondJson(res, 200, async () => {
          return marketplaceHandlers!["payment.getEscrowStatus"]({ orderId });
        });
        return;
      }

      // Payment API - Verify transaction
      if (req.method === "POST" && req.url === "/api/payment/verify") {
        void handleJsonBody(req, async (body) => {
          return marketplaceHandlers!["payment.verify"](body);
        }, res);
        return;
      }

      // ========================================
      // Tenant API (多租户)
      // ========================================

      // Create tenant
      if (req.method === "POST" && req.url === "/api/tenants") {
        void handleJsonBody(req, async (body) => {
          return tenantHandlers!["tenants.create"](body);
        }, res);
        return;
      }

      // List tenants
      if (req.method === "GET" && req.url === "/api/tenants") {
        void respondJson(res, 200, async () => {
          return tenantHandlers!["tenants.list"]({});
        });
        return;
      }

      // Get tenant by ID
      const tenantByIdMatch = req.url?.match(/^\/api\/tenants\/([a-f0-9-]+)$/);
      if (tenantByIdMatch && req.method === "GET") {
        void respondJson(res, 200, async () => {
          return tenantHandlers!["tenants.get"]({ id: tenantByIdMatch[1] });
        });
        return;
      }

      // Update tenant
      if (tenantByIdMatch && req.method === "PATCH") {
        void handleJsonBody(req, async (body) => {
          return tenantHandlers!["tenants.update"]({ id: tenantByIdMatch[1], ...body });
        }, res);
        return;
      }

      // Configure tenant OpenClaw
      if (tenantByIdMatch && req.method === "POST" && req.url?.endsWith("/openclaw")) {
        void handleJsonBody(req, async (body) => {
          return tenantHandlers!["tenants.configureOpenClaw"]({ tenantId: tenantByIdMatch[1], config: body });
        }, res);
        return;
      }

      // Get tenant OpenClaw status
      if (req.url?.match(/^\/api\/tenants\/([a-f0-9-]+)\/openclaw$/) && req.method === "GET") {
        const match = req.url.match(/^\/api\/tenants\/([a-f0-9-]+)\/openclaw$/);
        void respondJson(res, 200, async () => {
          return tenantHandlers!["tenants.getOpenClawStatus"]({ tenantId: match![1] });
        });
        return;
      }

      // Add user to tenant
      if (req.method === "POST" && req.url?.match(/^\/api\/tenants\/[a-f0-9-]+\/users$/)) {
        const match = req.url.match(/^\/api\/tenants\/([a-f0-9-]+)\/users$/);
        void handleJsonBody(req, async (body) => {
          return tenantHandlers!["tenants.addUser"]({ tenantId: match![1], ...body });
        }, res);
        return;
      }

      // List tenant users
      if (req.method === "GET" && req.url?.match(/^\/api\/tenants\/[a-f0-9-]+\/users$/)) {
        const match = req.url.match(/^\/api\/tenants\/([a-f0-9-]+)\/users$/);
        void respondJson(res, 200, async () => {
          return tenantHandlers!["tenants.listUsers"]({ tenantId: match![1] });
        });
        return;
      }

      // ========================================
      // Task API (任务派发)
      // ========================================

      // Create task
      if (req.method === "POST" && req.url === "/api/tasks") {
        void handleJsonBody(req, async (body) => {
          return taskHandlers!["marketplace.tasks.create"](body);
        }, res);
        return;
      }

      // List tasks
      if (req.method === "GET" && req.url === "/api/tasks") {
        void respondJson(res, 200, async () => {
          return taskHandlers!["marketplace.tasks.list"]({});
        });
        return;
      }

      // Get available tasks (抢单大厅)
      if (req.method === "GET" && req.url === "/api/tasks/available") {
        void respondJson(res, 200, async () => {
          return taskHandlers!["marketplace.tasks.available"]({});
        });
        return;
      }

      // Get task by ID
      const taskByIdMatch = req.url?.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
      if (taskByIdMatch && req.method === "GET") {
        void respondJson(res, 200, async () => {
          return taskHandlers!["marketplace.tasks.list"]({ taskId: taskByIdMatch[1] });
        });
        return;
      }

      // Claim task (抢单)
      if (taskByIdMatch && req.method === "POST" && req.url?.endsWith("/claim")) {
        void handleJsonBody(req, async (body) => {
          return taskHandlers!["marketplace.tasks.claim"]({ id: taskByIdMatch[1], ...body });
        }, res);
        return;
      }

      // Assign task (派单)
      if (taskByIdMatch && req.method === "POST" && req.url?.endsWith("/assign")) {
        void handleJsonBody(req, async (body) => {
          return taskHandlers!["marketplace.tasks.assign"]({ id: taskByIdMatch[1], ...body });
        }, res);
        return;
      }

      // Match task (智能匹配)
      if (taskByIdMatch && req.method === "POST" && req.url?.endsWith("/match")) {
        void handleJsonBody(req, async (body) => {
          return taskHandlers!["marketplace.tasks.match"]({ id: taskByIdMatch[1], ...body });
        }, res);
        return;
      }

      // Update task status
      if (taskByIdMatch && req.method === "PATCH") {
        void handleJsonBody(req, async (body) => {
          return taskHandlers!["marketplace.tasks.updateStatus"]({ id: taskByIdMatch[1], ...body });
        }, res);
        return;
      }

      // ========================================
      // Team API (临时组队)
      // ========================================

      // Create team
      if (req.method === "POST" && req.url === "/api/teams") {
        void handleJsonBody(req, async (body) => {
          const { name, ownerId, description, taskId, maxMembers, tenantId } = body as Record<string, unknown>;
          return teamHandlers?.["createTeam"]?.({
            name: String(name),
            ownerId: String(ownerId),
            description: description ? String(description) : undefined,
            taskId: taskId ? String(taskId) : undefined,
            maxMembers: maxMembers ? Number(maxMembers) : undefined,
            tenantId: tenantId ? String(tenantId) : undefined,
          }) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // List user teams
      if (req.method === "GET" && req.url === "/api/teams") {
        void handleJsonBody(req, async (body) => {
          const { userId } = body as Record<string, unknown>;
          return teamHandlers?.["listUserTeams"]?.(String(userId)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Join by invite code
      if (req.method === "POST" && req.url === "/api/teams/join") {
        void handleJsonBody(req, async (body) => {
          const { inviteCode, userId } = body as Record<string, unknown>;
          return teamHandlers?.["joinByCode"]?.(String(inviteCode), String(userId)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Get team details
      const teamByIdMatch = req.url?.match(/^\/api\/teams\/([a-f0-9-]+)$/);
      if (teamByIdMatch && req.method === "GET") {
        void respondJson(res, 200, async () => {
          return teamHandlers?.["getTeam"]?.(teamByIdMatch[1]) ?? { error: "Not configured" };
        });
        return;
      }

      // Update team
      if (teamByIdMatch && req.method === "PATCH") {
        void handleJsonBody(req, async (body) => {
          const { name, description } = body as Record<string, unknown>;
          return teamHandlers?.["updateTeam"]?.(teamByIdMatch[1], {
            name: name ? String(name) : undefined,
            description: description ? String(description) : undefined,
          }, "") ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Dissolve team
      if (teamByIdMatch && req.method === "DELETE") {
        void handleJsonBody(req, async (body) => {
          const { userId } = body as Record<string, unknown>;
          return teamHandlers?.["dissolveTeam"]?.(teamByIdMatch[1], String(userId)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // List team members
      if (req.url?.match(/^\/api\/teams\/[a-f0-9-]+\/members$/) && req.method === "GET") {
        const match = req.url.match(/^\/api\/teams\/([a-f0-9-]+)\/members$/);
        void respondJson(res, 200, async () => {
          return teamHandlers?.["listMembers"]?.(match![1]) ?? { error: "Not configured" };
        });
        return;
      }

      // Invite member
      if (req.url?.match(/^\/api\/teams\/[a-f0-9-]+\/members$/) && req.method === "POST") {
        const match = req.url.match(/^\/api\/teams\/([a-f0-9-]+)\/members$/);
        void handleJsonBody(req, async (body) => {
          const { userId, role } = body as Record<string, unknown>;
          return teamHandlers?.["inviteMember"]?.({
            teamId: match![1],
            userId: String(userId),
            role: role as "owner" | "admin" | "member" | undefined,
          }) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Leave team
      if (req.url?.match(/^\/api\/teams\/[a-f0-9-]+\/leave$/) && req.method === "POST") {
        const match = req.url.match(/^\/api\/teams\/([a-f0-9-]+)\/leave$/);
        void handleJsonBody(req, async (body) => {
          const { userId } = body as Record<string, unknown>;
          return teamHandlers?.["leaveTeam"]?.(match![1], String(userId)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Transfer ownership
      if (teamByIdMatch && req.method === "POST" && req.url?.endsWith("/transfer")) {
        void handleJsonBody(req, async (body) => {
          const { currentOwnerId, newOwnerId } = body as Record<string, unknown>;
          return teamHandlers?.["transferOwnership"]?.(teamByIdMatch[1], String(currentOwnerId), String(newOwnerId)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Remove member
      if (req.url?.match(/^\/api\/teams\/[a-f0-9-]+\/members\/[^/]+$/) && req.method === "DELETE") {
        const teamMatch = req.url.match(/^\/api\/teams\/([a-f0-9-]+)\/members\/([^/]+)$/);
        void handleJsonBody(req, async (body) => {
          const { requesterId } = body as Record<string, unknown>;
          return teamHandlers?.["removeMember"]?.(teamMatch![1], teamMatch![2], String(requesterId)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Accept invite
      if (req.url?.match(/^\/api\/teams\/[a-f0-9-]+\/accept$/) && req.method === "POST") {
        const match = req.url.match(/^\/api\/teams\/([a-f0-9-]+)\/accept$/);
        void handleJsonBody(req, async (body) => {
          const { userId } = body as Record<string, unknown>;
          return teamHandlers?.["acceptInvite"]?.(match![1], String(userId)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // ========================================
      // Task Queue API
      // ========================================

      // Enqueue task
      if (req.method === "POST" && req.url === "/api/queue") {
        void handleJsonBody(req, async (body) => {
          const { type, payload, priority, scheduledAt, maxRetries, tenantId } = body as Record<string, unknown>;
          return taskQueueHandlers?.["enqueue"]?.({
            type: String(type) as any,
            payload: payload as Record<string, unknown>,
            priority: priority ? Number(priority) : undefined,
            scheduledAt: scheduledAt ? new Date(String(scheduledAt)) : undefined,
            maxRetries: maxRetries ? Number(maxRetries) : undefined,
            tenantId: tenantId ? String(tenantId) : undefined,
          }) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Get queue status
      const queueStatusMatch = req.url?.match(/^\/api\/queue\/([a-f0-9-]+)$/);
      if (queueStatusMatch && req.method === "GET") {
        void respondJson(res, 200, async () => {
          return taskQueueHandlers?.["getStatus"]?.(queueStatusMatch[1]) ?? { error: "Not configured" };
        });
        return;
      }

      // List queue tasks
      if (req.method === "GET" && req.url === "/api/queue") {
        void handleJsonBody(req, async (body) => {
          const { tenantId, status, limit, offset } = body as Record<string, unknown>;
          return taskQueueHandlers?.["list"]?.(
            tenantId ? String(tenantId) : undefined,
            status ? String(status) as any : undefined,
            limit ? Number(limit) : 20,
            offset ? Number(offset) : 0,
          ) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Get queue stats
      if (req.method === "GET" && req.url === "/api/queue/stats") {
        void handleJsonBody(req, async (body) => {
          const { tenantId } = body as Record<string, unknown>;
          return taskQueueHandlers?.["getStats"]?.(tenantId ? String(tenantId) : undefined) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Cancel queue task
      if (queueStatusMatch && req.method === "DELETE") {
        void handleJsonBody(req, async () => {
          return taskQueueHandlers?.["cancel"]?.(queueStatusMatch[1]) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Process next task (for workers)
      if (req.method === "POST" && req.url === "/api/queue/process") {
        void handleJsonBody(req, async (body) => {
          const { tenantId } = body as Record<string, unknown>;
          return taskQueueHandlers?.["processNext"]?.(tenantId ? String(tenantId) : undefined) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // ========================================
      // OpenClaw Cluster API
      // ========================================

      // Register cluster instance
      if (req.method === "POST" && req.url === "/api/cluster/instances") {
        void handleJsonBody(req, async (body) => {
          const { name, type, url, token, capacity, region, tenantId } = body as Record<string, unknown>;
          return openClawClusterHandlers?.["registerInstance"]?.({
            name: String(name),
            type: String(type) as any,
            url: String(url),
            token: token ? String(token) : undefined,
            capacity: capacity ? Number(capacity) : undefined,
            region: region ? String(region) : undefined,
            tenantId: tenantId ? String(tenantId) : undefined,
          }) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // List cluster instances
      if (req.method === "GET" && req.url === "/api/cluster/instances") {
        void handleJsonBody(req, async (body) => {
          const { tenantId, status } = body as Record<string, unknown>;
          return openClawClusterHandlers?.["listInstances"]?.(
            tenantId ? String(tenantId) : undefined,
            status ? String(status) as any : undefined,
          ) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Get cluster instance by ID
      const clusterInstanceMatch = req.url?.match(/^\/api\/cluster\/instances\/([a-f0-9-]+)$/);
      if (clusterInstanceMatch && req.method === "GET") {
        void respondJson(res, 200, async () => {
          const instances = await openClawClusterHandlers?.["listInstances"]?.() ?? [];
          const instance = (instances as any[]).find((i: any) => i.id === clusterInstanceMatch[1]);
          return instance ?? { error: "Not found" };
        });
        return;
      }

      // Cluster instance heartbeat
      if (clusterInstanceMatch && req.method === "POST" && req.url?.endsWith("/heartbeat")) {
        void handleJsonBody(req, async () => {
          return openClawClusterHandlers?.["heartbeat"]?.(clusterInstanceMatch[1]) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Update instance load
      if (clusterInstanceMatch && req.method === "POST" && req.url?.endsWith("/load")) {
        void handleJsonBody(req, async (body) => {
          const { load } = body as Record<string, unknown>;
          return openClawClusterHandlers?.["updateLoad"]?.(clusterInstanceMatch[1], Number(load)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Get cluster stats
      if (req.method === "GET" && req.url === "/api/cluster/stats") {
        void handleJsonBody(req, async (body) => {
          const { tenantId } = body as Record<string, unknown>;
          return openClawClusterHandlers?.["getClusterStats"]?.(tenantId ? String(tenantId) : undefined) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Get available instance (for task assignment)
      if (req.method === "GET" && req.url === "/api/cluster/available") {
        void handleJsonBody(req, async (body) => {
          const { tenantId } = body as Record<string, unknown>;
          return openClawClusterHandlers?.["getAvailableInstance"]?.(tenantId ? String(tenantId) : undefined) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Assign task to instance
      if (req.method === "POST" && req.url === "/api/cluster/assign") {
        void handleJsonBody(req, async (body) => {
          const { requiredSkills, preferredRegion } = body as Record<string, unknown>;
          return openClawClusterHandlers?.["assignTask"]?.(
            requiredSkills ? (requiredSkills as string[]) : undefined,
            preferredRegion ? String(preferredRegion) : undefined,
          ) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Release task from instance
      if (req.method === "POST" && req.url === "/api/cluster/release") {
        void handleJsonBody(req, async (body) => {
          const { instanceId } = body as Record<string, unknown>;
          return openClawClusterHandlers?.["releaseTask"]?.(String(instanceId)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Deregister instance
      if (clusterInstanceMatch && req.method === "DELETE") {
        void handleJsonBody(req, async () => {
          return openClawClusterHandlers?.["deregister"]?.(clusterInstanceMatch[1]) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Set instance status
      if (clusterInstanceMatch && req.method === "PATCH") {
        void handleJsonBody(req, async (body) => {
          const { status } = body as Record<string, unknown>;
          return openClawClusterHandlers?.["setStatus"]?.(clusterInstanceMatch[1], String(status) as any) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // ========================================
      // Team Task API (任务拆分)
      // ========================================

      // Create subtask
      if (req.method === "POST" && req.url === "/api/subtasks") {
        void handleJsonBody(req, async (body) => {
          const { taskId, title, description, assigneeId, priority, orderIndex } = body as Record<string, unknown>;
          return teamTaskHandlers?.["createSubtask"]?.({
            taskId: String(taskId),
            title: String(title),
            description: description ? String(description) : undefined,
            assigneeId: assigneeId ? String(assigneeId) : undefined,
            priority: priority ? Number(priority) : undefined,
            orderIndex: orderIndex ? Number(orderIndex) : undefined,
          }) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Batch create subtasks
      if (req.method === "POST" && req.url === "/api/subtasks/batch") {
        void handleJsonBody(req, async (body) => {
          const { taskId, subtasks } = body as Record<string, unknown>;
          const parsedSubtasks = (subtasks as Array<Record<string, unknown>>)?.map(s => ({
            title: String(s.title),
            description: s.description ? String(s.description) : undefined,
            assigneeId: s.assigneeId ? String(s.assigneeId) : undefined,
            priority: s.priority ? Number(s.priority) : undefined,
          })) ?? [];
          return teamTaskHandlers?.["createSubtasks"]?.(String(taskId), parsedSubtasks) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Get subtasks by task
      const subtasksByTaskMatch = req.url?.match(/^\/api\/tasks\/([a-f0-9-]+)\/subtasks$/);
      if (subtasksByTaskMatch && req.method === "GET") {
        void respondJson(res, 200, async () => {
          return teamTaskHandlers?.["listSubtasks"]?.(subtasksByTaskMatch[1]) ?? { error: "Not configured" };
        });
        return;
      }

      // Get task progress
      if (req.url?.match(/^\/api\/tasks\/[a-f0-9-]+\/progress$/) && req.method === "GET") {
        const match = req.url.match(/^\/api\/tasks\/([a-f0-9-]+)\/progress$/);
        void respondJson(res, 200, async () => {
          return teamTaskHandlers?.["getTaskProgress"]?.(match![1]) ?? { error: "Not configured" };
        });
        return;
      }

      // Get subtask by ID
      const subtaskByIdMatch = req.url?.match(/^\/api\/subtasks\/([a-f0-9-]+)$/);
      if (subtaskByIdMatch) {
        if (req.method === "GET") {
          void respondJson(res, 200, async () => {
            return teamTaskHandlers?.["getSubtask"]?.(subtaskByIdMatch[1]) ?? { error: "Not configured" };
          });
          return;
        }
        if (req.method === "PATCH" || req.method === "PUT") {
          void handleJsonBody(req, async (body) => {
            const { title, description, assigneeId, status, priority, orderIndex, result } = body as Record<string, unknown>;
            return teamTaskHandlers?.["updateSubtask"]?.(subtaskByIdMatch[1], {
              title: title ? String(title) : undefined,
              description: description !== undefined ? String(description) : undefined,
              assigneeId: assigneeId !== undefined ? String(assigneeId) : undefined,
              status: status ? String(status) as any : undefined,
              priority: priority ? Number(priority) : undefined,
              orderIndex: orderIndex ? Number(orderIndex) : undefined,
              result: result as Record<string, unknown> | undefined,
            }) ?? { error: "Not configured" };
          }, res);
          return;
        }
        if (req.method === "DELETE") {
          void handleJsonBody(req, async (body) => {
            const { userId } = body as Record<string, unknown>;
            return teamTaskHandlers?.["deleteSubtask"]?.(subtaskByIdMatch[1], userId ? String(userId) : undefined) ?? { error: "Not configured" };
          }, res);
          return;
        }
      }

      // Assign subtask
      if (subtaskByIdMatch && req.method === "POST" && req.url?.endsWith("/assign")) {
        void handleJsonBody(req, async (body) => {
          const { userId } = body as Record<string, unknown>;
          return teamTaskHandlers?.["assignSubtask"]?.(subtaskByIdMatch[1], String(userId)) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Complete subtask
      if (subtaskByIdMatch && req.method === "POST" && req.url?.endsWith("/complete")) {
        void handleJsonBody(req, async (body) => {
          const { result } = body as Record<string, unknown>;
          return teamTaskHandlers?.["completeSubtask"]?.(subtaskByIdMatch[1], result as Record<string, unknown> | undefined) ?? { error: "Not configured" };
        }, res);
        return;
      }

      // Get user subtasks
      if (req.method === "GET" && req.url === "/api/my/subtasks") {
        void handleJsonBody(req, async (body) => {
          const { userId, status } = body as Record<string, unknown>;
          return teamTaskHandlers?.["getUserSubtasks"]?.(String(userId), status ? String(status) as any : undefined) ?? { error: "Not configured" };
        }, res);
        return;
      }
    }

    writeError(res, 404, "Not Found", "NOT_FOUND");
  });
}

async function respondJson(
  res: http.ServerResponse,
  statusCode: number,
  buildPayload: () => Promise<unknown>,
): Promise<void> {
  try {
    const payload = await buildPayload();
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[gateway] 500 error:", msg);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "服务暂时不可用，请稍后重试" }));
  }
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/** Unified error response: { ok: false, error: string, code?: string }.
 *  5xx: generic user message, actual error logged separately. */
function writeError(
  res: http.ServerResponse,
  statusCode: number,
  error: string,
  code?: string,
): void {
  setCorsHeaders(res);
  if (statusCode >= 500) {
    console.error(`[gateway] ${statusCode} error:`, error);
    error = "服务暂时不可用，请稍后重试";
  }
  const payload: { ok: false; error: string; code?: string } = {
    ok: false,
    error,
    ...(code ? { code } : {}),
  };
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

type RegisterBody = { id: string; name?: string; kind?: RegisteredDevice["kind"] };

async function handleRegisterAssistant(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: {
    devices: DeviceManager;
    hiddenIds: HiddenAssistantIds;
    persistAssistantsData?: () => void | Promise<void>;
  },
): Promise<void> {
  setCorsHeaders(res);
  let body: RegisterBody;
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as RegisterBody;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  if (!body?.id || typeof body.id !== "string") {
    writeError(res, 400, "Missing or invalid body.id", "INVALID_BODY");
    return;
  }
  const kind =
    body.kind === "pc" || body.kind === "sdk" || body.kind === "custom" || body.kind === "openclaw"
      ? body.kind
      : "pc";
  deps.devices.upsert({
    id: body.id,
    kind,
    status: "offline",
    lastSeenAt: Date.now(),
    name: body.name,
  });
  deps.hiddenIds.remove(body.id);
  await deps.persistAssistantsData?.();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: body.id }));
}

/**
 * Handle POST /api/assistants/:id/connection - Save connection config
 */
async function handleConnection(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: {
    assistantConfig: AssistantConfigStore;
    persistAssistantsData?: () => void | Promise<void>;
  },
): Promise<void> {
  setCorsHeaders(res);
  let body: {
    type?: string;
    url?: string;
    token?: string;
    restUrl?: string;
    restToken?: string;
  };
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw);
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }

  // Validate connection type
  const validTypes = ["plugin", "direct", "rest"];
  const connectionType = validTypes.includes(body.type ?? "") ? body.type : "plugin";

  // Get existing config or default
  const existingConfig = deps.assistantConfig.get(assistantId);
  const assistantName = existingConfig?.name ?? assistantId;

  // Update connection config
  const updated = deps.assistantConfig.update(assistantId, assistantName, {
    connection: {
      type: connectionType as "plugin" | "direct" | "rest",
      url: body.url,
      token: body.token,
      restUrl: body.restUrl,
      restToken: body.restToken,
    },
  });

  await deps.persistAssistantsData?.();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, connection: updated.connection }));
}

/**
 * Handle POST /api/assistants/:id/test-connection - Test connection
 */
async function handleTestConnection(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: {
    assistantConfig: AssistantConfigStore;
  },
): Promise<void> {
  setCorsHeaders(res);
  let body: {
    type?: string;
    url?: string;
    token?: string;
    restUrl?: string;
    restToken?: string;
  };
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw);
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }

  const connectionType = body.type ?? "direct";

  try {
    if (connectionType === "rest") {
      // Test REST API connection
      const restUrl = body.restUrl;
      const restToken = body.restToken;
      if (!restUrl) {
        writeError(res, 400, "Missing REST URL", "INVALID_BODY");
        return;
      }

      // Simple health check to REST endpoint
      const response = await fetch(`${restUrl}/v1/models`, {
        headers: restToken ? { Authorization: `Bearer ${restToken}` } : {},
      });

      if (response.ok) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          type: "rest",
          message: "REST API connection successful",
          agents: ["Available via REST (limited)"],
        }));
      } else {
        writeError(res, 400, `REST API error: ${response.status}`, "CONNECTION_FAILED");
      }
      return;
    }

    // For direct mode, try WebSocket connection
    const url = body.url;
    const token = body.token;
    if (!url) {
      writeError(res, 400, "Missing OpenClaw URL", "INVALID_BODY");
      return;
    }

    // Import dynamically to avoid circular deps
    const { OpenClawAdapter } = await import("@aifc/client-openclaw-adapter");
    const adapter = new OpenClawAdapter({
      url,
      token: token ?? "",
      assistantId,
      requestTimeoutMs: 10000,
    });

    try {
      const hello = await adapter.connect();
      adapter.disconnect();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        type: "direct",
        message: "OpenClaw connection successful",
        hello: {
          protocol: hello.protocol,
          server: hello.server,
        },
      }));
    } catch (err) {
      writeError(
        res,
        400,
        `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
        "CONNECTION_FAILED",
      );
    }
  } catch (err) {
    writeError(
      res,
      500,
      `Test failed: ${err instanceof Error ? err.message : String(err)}`,
      "INTERNAL_ERROR",
    );
  }
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleJsonBody(
  req: http.IncomingMessage,
  handler: (body: Record<string, unknown>) => Promise<unknown>,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const bodyStr = await readRequestBody(req);
    const body = bodyStr ? JSON.parse(bodyStr) : {};
    const result = await handler(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[gateway] API error:", msg);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: msg }));
  }
}

type AssistantConfigDeps = {
  devices: DeviceManager;
  sessions: ISessionStore;
  openClaw: OpenClawGatewayService;
  assistantConfig: AssistantConfigStore;
  trainingProgress: ITrainingProgressStore;
  trainingSessions: ITrainingSessionStore;
  hiddenIds: HiddenAssistantIds;
  delistedIds: DelistedAssistantIds;
  persistAssistantsData?: () => void | Promise<void>;
};

async function resolveAssistantById(
  deps: AssistantConfigDeps,
  id: string,
): Promise<{ id: string; name: string } | null> {
  const assistants = await getAssistantsListRaw({
    devices: deps.devices,
    openClaw: deps.openClaw,
  });
  const found = assistants.find((a) => a.id === id);
  return found ? { id: found.id, name: found.name } : null;
}

async function resolveAssistantWithProvider(
  deps: AssistantConfigDeps,
  id: string,
): Promise<{ id: string; name: string; provider: string } | null> {
  const assistants = await getAssistantsListRaw({
    devices: deps.devices,
    openClaw: deps.openClaw,
  });
  const found = assistants.find((a) => a.id === id);
  return found ? { id: found.id, name: found.name, provider: found.provider } : null;
}

async function handleGetAssistant(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const { assistants } = await getAssistantsList({
    devices: deps.devices,
    openClaw: deps.openClaw,
    hiddenIds: deps.hiddenIds,
    delistedIds: deps.delistedIds,
  });
  const found = assistants.find((a) => a.id === assistantId);
  if (!found) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(found));
}

async function handleDeleteAssistant(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const rawList = await getAssistantsListRaw({
    devices: deps.devices,
    openClaw: deps.openClaw,
  });
  const found = rawList.find((a) => a.id === assistantId);
  if (!found) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  deps.devices.remove(assistantId);
  deps.assistantConfig.delete(assistantId);
  deps.hiddenIds.add(assistantId);
  await deps.persistAssistantsData?.();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: assistantId }));
}

type PatchAssistantBody = { name?: string; isDelisted?: boolean };

async function handlePatchAssistant(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const { assistants } = await getAssistantsList({
    devices: deps.devices,
    openClaw: deps.openClaw,
    hiddenIds: deps.hiddenIds,
    delistedIds: deps.delistedIds,
  });
  const found = assistants.find((a) => a.id === assistantId);
  if (!found) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  let body: PatchAssistantBody;
  try {
    const raw = await readRequestBody(req);
    body = (raw ? JSON.parse(raw) : {}) as PatchAssistantBody;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  if (body.name !== undefined && typeof body.name === "string") {
    const device = deps.devices.get(assistantId);
    if (device) {
      deps.devices.upsert({ ...device, name: body.name });
    }
  }
  if (body.isDelisted === true) {
    deps.delistedIds.add(assistantId);
  } else if (body.isDelisted === false) {
    deps.delistedIds.remove(assistantId);
  }
  await deps.persistAssistantsData?.();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: assistantId }));
}

function extractChatContent(message: unknown): string {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object") return "";
  const obj = message as { content?: unknown; text?: unknown };
  if (typeof obj.text === "string") return obj.text;
  const content = obj.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (!entry || typeof entry !== "object") return "";
        const typed = entry as { type?: unknown; text?: unknown };
        return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
      })
      .join("");
  }
  return "";
}

async function handleGetAssistantConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  const config = deps.assistantConfig.getOrDefault(assistant.id, assistant.name);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(config));
}

async function handlePatchAssistantConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  let body: AssistantConfigPayload;
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as AssistantConfigPayload;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  deps.assistantConfig.update(assistant.id, assistant.name, body);
  await deps.persistAssistantsData?.();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: assistant.id }));
}

// --- Training handlers ---

async function handleTrainingChatSend(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  if (!deps.openClaw.isEnabled()) {
    const status = await deps.openClaw.getStatus();
    writeError(
      res,
      503,
      status.connected ? "OpenClaw unavailable" : "OpenClaw not connected",
      "OPENCLAW_NOT_AVAILABLE",
    );
    return;
  }
  let body: { message?: string; sessionKey?: string };
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as typeof body;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  const message = typeof body?.message === "string" ? body.message : "";
  if (!message.trim()) {
    writeError(res, 400, "Missing or empty message", "INVALID_BODY");
    return;
  }
  const cfg = deps.assistantConfig.getOrDefault(assistant.id, assistant.name);
  const deny = contentViolatesDenyConstraints(message, cfg.constraints);
  if (deny.violated) {
    writeError(
      res,
      403,
      `Blocked by constraint: ${deny.rule}`,
      "CONSTRAINT_BLOCKED",
    );
    return;
  }
  const cost = costMonthlyLimitBlocks(cfg);
  if (cost.blocked) {
    writeError(res, 429, cost.reason ?? "Monthly token limit reached", "COST_LIMIT");
    return;
  }
  const sessionKey =
    typeof body?.sessionKey === "string" && body.sessionKey
      ? body.sessionKey
      : `training-${assistant.id}`;

  res.setTimeout(65_000, () => {
    if (!res.writableEnded) {
      res.destroy();
    }
  });

  try {
    const prefix = buildPersonaSystemPrefix(cfg);
    const augmented = prefix ? prefix + message : message;
    console.log("[training/chat/send] start", { assistantId, sessionKey, messageLen: message.length });
    const rawMessage = await deps.openClaw.sendChatForTraining({
      sessionKey,
      message: augmented,
      idempotencyKey: undefined,
    });
    const content = extractChatContent(rawMessage);
    const usageDeltaM =
      estimateTokensM(augmented) + Math.max(estimateTokensM(content), 0.001);
    const used = cfg.costControl.tokenUsedThisMonthM ?? 0;
    deps.assistantConfig.update(assistant.id, assistant.name, {
      costControl: { tokenUsedThisMonthM: used + usageDeltaM },
    });
    await deps.persistAssistantsData?.();
    console.log("[training/chat/send] ok", { assistantId, contentLen: String(content).length });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ role: "assistant", content }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : "OpenClaw chat failed";
    console.warn("[training/chat/send] failed", { assistantId, sessionKey, error: msg });
    writeError(res, 502, msg, "OPENCLAW_CHAT_FAILED");
  }
}

async function handleTrainingTools(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  const tools = getAssistantTools(assistant.id, deps.assistantConfig);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(tools));
}

async function handleChatEvaluate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  let body: { messages?: Array<{ role: string; content: string }>; testPrompt?: string };
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as typeof body;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  let messages = body.messages ?? [];
  const testPrompt = typeof body.testPrompt === "string" ? body.testPrompt.trim() : "";
  const evalConfig = deps.assistantConfig.getOrDefault(assistant.id, assistant.name);
  if (testPrompt) {
    const preDeny = contentViolatesDenyConstraints(testPrompt, evalConfig.constraints);
    if (preDeny.violated) {
      writeError(
        res,
        403,
        `Blocked by constraint: ${preDeny.rule}`,
        "CONSTRAINT_BLOCKED",
      );
      return;
    }
  }
  if (testPrompt && deps.openClaw.isEnabled()) {
    const withProvider = await resolveAssistantWithProvider(deps, assistant.id);
    if (withProvider?.provider === "openclaw") {
      try {
        const tpPrefix = buildPersonaSystemPrefix(evalConfig);
        const augmentedPrompt = tpPrefix ? tpPrefix + testPrompt : testPrompt;
        const rawReply = await deps.openClaw.sendChatForTraining({
          sessionKey: `training-${assistant.id}`,
          message: augmentedPrompt,
          idempotencyKey: undefined,
        });
        const content = extractChatContent(rawReply);
        messages = [
          { role: "user", content: testPrompt },
          { role: "assistant", content },
        ];
      } catch {
        writeError(res, 502, "Failed to get assistant reply", "OPENCLAW_CHAT_FAILED");
        return;
      }
    }
  }
  const userBlob = messages
    .filter((m) => m?.role === "user" && typeof m.content === "string")
    .map((m) => m.content)
    .join("\n");
  const postDeny = contentViolatesDenyConstraints(userBlob, evalConfig.constraints);
  if (postDeny.violated) {
    writeError(
      res,
      403,
      `Blocked by constraint: ${postDeny.rule}`,
      "CONSTRAINT_BLOCKED",
    );
    return;
  }
  const result = evaluateChat(assistant.id, evalConfig, { messages });
  await deps.trainingProgress.update(assistant.id, {
    chat: { score: result.score, lastEvaluatedAt: new Date().toISOString() },
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}

async function handleExecTest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  let body: { toolId?: string };
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as typeof body;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  const toolId = typeof body.toolId === "string" ? body.toolId : "";
  if (!toolId) {
    writeError(res, 400, "Missing toolId", "INVALID_BODY");
    return;
  }
  const execCfg = deps.assistantConfig.getOrDefault(assistant.id, assistant.name);
  if (
    execCfg.tools.length > 0 &&
    !execCfg.tools.some((t) => t.id === toolId)
  ) {
    writeError(res, 400, "Tool is not in this assistant's mounted tool list", "TOOL_NOT_MOUNTED");
    return;
  }
  const tools = getAssistantTools(assistant.id, deps.assistantConfig);
  const result = await executeToolTest(toolId, tools);
  const progress = await deps.trainingProgress.getOrDefault(assistant.id);
  const toolResults = [
    ...(progress.exec.toolResults ?? []),
    {
      toolId: result.toolId,
      passed: result.passed,
      durationMs: result.durationMs,
      error: result.error ?? undefined,
    },
  ];
  const passed = toolResults.filter((r) => r.passed).length;
  await deps.trainingProgress.update(assistant.id, {
    exec: { passRate: Math.round((passed / toolResults.length) * 100), toolResults },
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}

async function handleExecInject(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  let body: { toolId?: string; schema?: string; examples?: string[] };
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as typeof body;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  if (!body?.toolId || typeof body.toolId !== "string") {
    writeError(res, 400, "Missing toolId", "INVALID_BODY");
    return;
  }
  injectToolHints(assistant.id, { toolId: body.toolId, schema: body.schema, examples: body.examples });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

async function handleTaskAnalyze(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  let body: { taskDescription?: string; taskType?: "dev" | "data" | "audit" };
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as typeof body;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  const result = analyzeTask({
    taskDescription: body.taskDescription ?? "",
    taskType: body.taskType,
  });
  const progress = await deps.trainingProgress.getOrDefault(assistant.id);
  await deps.trainingProgress.update(assistant.id, {
    task: { analyzedCount: (progress.task.analyzedCount ?? 0) + 1 },
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}

async function handleTaskChain(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  let body: { taskId?: string; subtasks?: Array<{ id: string; description: string }> };
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as typeof body;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  const tools = getAssistantTools(assistant.id, deps.assistantConfig);
  const result = generateTaskChain(
    { taskId: body.taskId, subtasks: body.subtasks ?? [] },
    tools,
  );
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}

async function handleGetTrainingProgress(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  const progress = await deps.trainingProgress.getOrDefault(assistant.id);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      chat: progress.chat,
      exec: progress.exec,
      task: progress.task,
    }),
  );
}

async function handlePostTrainingProgress(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  let body: { chat?: object; exec?: object; task?: object };
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw) as typeof body;
  } catch {
    writeError(res, 400, "Invalid JSON body", "INVALID_BODY");
    return;
  }
  await deps.trainingProgress.update(assistant.id, body);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

async function handleAssistantTasks(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  const workspaceSessions = await deps.sessions.list();
  const tasks = workspaceSessions.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.title,
    status: s.status === "active" ? "in_progress" : "idle",
  }));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(tasks));
}

async function handleCreateTrainingSession(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  const record = await deps.trainingSessions.create(assistant.id);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ sessionId: record.id }));
}

async function handleGetTrainingSession(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  assistantId: string,
  sessionId: string,
  deps: AssistantConfigDeps,
): Promise<void> {
  setCorsHeaders(res);
  const assistant = await resolveAssistantById(deps, assistantId);
  if (!assistant) {
    writeError(res, 404, "Assistant not found", "ASSISTANT_NOT_FOUND");
    return;
  }
  const session = await deps.trainingSessions.get(sessionId);
  if (!session || session.assistantId !== assistant.id) {
    writeError(res, 404, "Training session not found", "SESSION_NOT_FOUND");
    return;
  }
  const progress = await deps.trainingProgress.getOrDefault(assistant.id);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      id: session.id,
      assistantId: session.assistantId,
      createdAt: session.createdAt,
      progress: session.progress ?? progress,
    }),
  );
}
