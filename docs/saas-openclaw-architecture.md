# SaaS 技能交易平台 OpenClaw 云端接入方案

本文档描述如何将当前本地直连 OpenClaw 的架构升级为支持 SaaS 形态的技能交易平台。

---

## 一、现状分析

### 1.1 当前架构

```
前端 Browser → Gateway :3001 → OpenClaw (ws://localhost:18789)
```

**问题**：
- 只能连接本地 OpenClaw
- 无法实现任务派发/多工作者
- 缺少交易闭环（支付/佣金）
- 不符合 SaaS 产品形态

### 1.2 已实现功能

| 模块 | 状态 | 说明 |
|------|------|------|
| 技能 CRUD | ✅ 已实现 | `backend/gateway/src/methods/marketplace.ts` |
| 订单创建 | ✅ 已实现 | `POST /api/orders` |
| 钱包查询 | ✅ 已实现 | `GET /api/wallet` |
| 提现申请 | ✅ 已实现 | `POST /api/wallet/withdraw` |
| 评价系统 | ✅ 已实现 | `POST /api/reviews` |
| 佣金计算 | ✅ 已实现 | 阶梯佣金 8%-15% |
| 数据库 Schema | ✅ 已实现 | `docs/api/skill-marketplace-schema.md` |

### 1.3 待实现功能

| 模块 | 状态 | 说明 |
|------|------|------|
| **OpenClaw 集群** | ✅ 已实现 | `services/openclaw-cluster.ts` - 多实例注册/心跳/负载均衡 |
| **任务调度系统** | ✅ 已实现 | `services/task-queue.ts` - 异步任务队列 |
| **技能匹配引擎** | ✅ 已实现 | `methods/tasks.ts` - marketplace.tasks.match |
| **实时通知** | ✅ 已实现 | `services/realtime-events.ts` - WebSocket 推送 |
| **团队协作** | ✅ 已实现 | `services/team-service.ts` + `services/team-task-service.ts` |
| **临时组队** | ✅ 已实现 | `teams` / `team_members` 表 + 邀请码机制 |
| **支付网关集成** | ⚠️ 占位符 | 需对接真实支付渠道 |
| **多租户隔离** | ✅ 已实现 | 完整 tenant 架构 + tenant_users 关联 |

---

## 二、目标架构

### 2.1 系统架构图

```mermaid
flowchart TB
    subgraph Client ["客户端"]
        A[Web 前端]
        B[移动端 H5]
    end
    
    subgraph Gateway ["云端 API Gateway"]
        C[REST API]
        D[WebSocket Server]
        E[鉴权中间件]
        F[限流/监控]
    end
    
    subgraph Core ["核心服务"]
        G[任务调度器]
        H[技能匹配引擎]
        I[支付/佣金服务]
        J[通知服务]
    end
    
    subgraph Infrastructure ["基础设施"]
        K[(PostgreSQL)]
        L[(Redis)]
        M[任务队列]
    end
    
    subgraph WorkerPool ["OpenClaw 集群"]
        N[Worker 1]
        O[Worker 2]
        P[Worker N]
    end
    
    A --> C
    B --> C
    C --> E
    E --> F
    C --> G
    G --> H
    G --> M
    M --> N
    M --> O
    M --> P
    G --> I
    I --> K
    M --> L
    D <--> A
    D <--> B
```

### 2.2 核心业务流程

```mermaid
sequenceDiagram
    participant Client as 需求方
    participant Gateway as 云端 Gateway
    participant Queue as 任务队列
    participant Worker as OpenClaw Worker
    participant Payment as 支付/佣金

    Client->>Gateway: 发布任务
    Gateway->>Gateway: 技能匹配
    Gateway->>Queue: 加入任务队列
    Queue->>Worker: 派发任务
    Worker->>Worker: 执行任务
    Worker->>Gateway: 提交结果
    Gateway->>Client: 通知完成
    Client->>Gateway: 确认验收
    Gateway->>Payment: 结算付款
    Payment-->>Client: 交易完成
```

---

## 三、技术实现方案

### 3.1 OpenClaw 集群管理

**新增文件**：`backend/gateway/src/openclaw/cluster-manager.ts`

```typescript
interface OpenClawInstance {
  id: string;
  url: string;
  token: string;
  capabilities: string[];
  status: 'idle' | 'busy' | 'offline';
  currentTaskId?: string;
  registeredAt: number;
  loadFactor: number;  // 负载因子，用于调度
}

class OpenClawClusterManager {
  private instances = new Map<string, OpenClawInstance>();
  
  // 注册新的 Worker 实例
  async registerInstance(config: {
    url: string;
    token: string;
    assistantId?: string;
  }): Promise<string> {
    const instanceId = crypto.randomUUID();
    const adapter = new OpenClawAdapter({
      url: config.url,
      token: config.token,
      requestTimeoutMs: 60000
    });
    
    const hello = await adapter.connect();
    
    this.instances.set(instanceId, {
      id: instanceId,
      url: config.url,
      token: config.token,
      capabilities: Object.keys(hello.features?.methods || {}),
      status: 'idle',
      registeredAt: Date.now(),
      loadFactor: 0
    });
    
    return instanceId;
  }
  
  // 派发任务
  async dispatch(task: Task): Promise<DispatchResult> {
    const instance = this.selectBestInstance(task);
    if (!instance) {
      throw new Error('No available worker');
    }
    
    instance.status = 'busy';
    instance.currentTaskId = task.id;
    
    const adapter = new OpenClawAdapter({
      url: instance.url,
      token: instance.token,
      requestTimeoutMs: 60000
    });
    
    const result = await adapter.dispatchTask({
      message: task.prompt,
      workspaceId: task.workspace_id,
      taskId: task.id
    });
    
    return { instanceId: instance.id, result };
  }
  
  // 根据技能选择最优实例
  private selectBestInstance(task: Task): OpenClawInstance | null {
    const required = task.requirements?.skills || [];
    
    const candidates = [...this.instances.values()]
      .filter(i => i.status === 'idle')
      .filter(i => this.matchCapabilities(i, required))
      .sort((a, b) => a.loadFactor - b.loadFactor);
    
    return candidates[0] || null;
  }
  
  private matchCapabilities(instance: OpenClawInstance, required: string[]): boolean {
    if (required.length === 0) return true;
    return required.every(skill => 
      instance.capabilities.some(cap => cap.toLowerCase().includes(skill.toLowerCase()))
    );
  }
}
```

### 3.2 任务调度系统

**新增文件**：`backend/gateway/src/tasks/task-scheduler.ts`

```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  requirements: {
    skills: string[];
    deadline?: number;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
  };
  budget: number;
  status: TaskStatus;
  created_by: string;
  assigned_to?: string;
  prompt?: string;  // 给 OpenClaw 的指令
  workspace_id?: string;
}

const TaskStatus = {
  PENDING: 'pending',      // 待接单
  ACCEPTED: 'accepted',    // 已接单
  RUNNING: 'running',      // 执行中
  SUBMITTED: 'submitted',  // 已提交
  COMPLETED: 'completed',  // 已完成
  FAILED: 'failed',
  CANCELLED: 'cancelled'
} as const;

class TaskScheduler {
  private clusterManager: OpenClawClusterManager;
  private redis: Redis;
  
  // 智能匹配工作者
  async findBestWorker(task: Task): Promise<Worker | null> {
    const requiredSkills = task.requirements?.skills || [];
    
    // 查询具备所需技能的工作者
    const workers = await this.findWorkersBySkills(requiredSkills);
    
    // 过滤在线且空闲的
    const available = workers.filter(w => 
      w.status === 'online' && !w.current_task_id
    );
    
    if (available.length === 0) return null;
    
    // 智能排序：技能匹配度(40%) + 评分(30%) + 完成率(20%) + 价格(10%)
    return this.rankWorkers(available, task);
  }
  
  // 处理任务状态转换
  async transitionTask(taskId: string, from: TaskStatus, to: TaskStatus): Promise<void> {
    const allowed = {
      [TaskStatus.PENDING]: [TaskStatus.ACCEPTED, TaskStatus.CANCELLED],
      [TaskStatus.ACCEPTED]: [TaskStatus.RUNNING, TaskStatus.CANCELLED],
      [TaskStatus.RUNNING]: [TaskStatus.SUBMITTED, TaskStatus.FAILED],
      [TaskStatus.SUBMITTED]: [TaskStatus.COMPLETED, TaskStatus.FAILED],
    };
    
    if (!allowed[from]?.includes(to)) {
      throw new Error(`Invalid transition: ${from} -> ${to}`);
    }
    
    await this.updateTaskStatus(taskId, to);
    
    // 自动派发任务
    if (to === TaskStatus.ACCEPTED) {
      await this.dispatchToWorker(taskId);
    }
  }
  
  // 派发给 OpenClaw Worker
  private async dispatchToWorker(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    
    try {
      const result = await this.clusterManager.dispatch(task);
      console.log(`[task] dispatched to ${result.instanceId}:`, result.result);
    } catch (error) {
      console.error(`[task] dispatch failed:`, error);
      await this.transitionTask(taskId, TaskStatus.ACCEPTED, TaskStatus.FAILED);
    }
  }
}
```

### 3.3 实时通知服务

**新增文件**：`backend/gateway/src/services/notification-service.ts`

```typescript
class NotificationService {
  private subscribers = new Map<string, Set<WebSocket>>();
  
  // 订阅任务更新
  subscribeTask(userId: string, taskId: string, ws: WebSocket): void {
    const key = `task:${taskId}`;
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(ws);
  }
  
  // 推送任务状态变化
  async notifyTaskUpdate(taskId: string, data: TaskUpdate): Promise<void> {
    const key = `task:${taskId}`;
    const subscribers = this.subscribers.get(key) || [];
    
    const message = JSON.stringify({
      type: 'task.update',
      taskId,
      data
    });
    
    for (const ws of subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }
  
  // 推送新任务给工作者
  async notifyWorkerNewTask(workerId: string, task: Task): Promise<void> {
    const key = `worker:${workerId}`;
    const subscribers = this.subscribers.get(key) || [];
    
    const message = JSON.stringify({
      type: 'task.assigned',
      task: {
        id: task.id,
        title: task.title,
        budget: task.budget,
        skills: task.requirements?.skills
      }
    });
    
    for (const ws of subscribers) {
      ws.send(message);
    }
  }
}
```

### 3.4 数据库扩展

**新增表**：`docs/api/saas-extended-schema.md`

```sql
-- 任务表（新增）
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    requirements JSONB,  -- { skills: [], deadline: null, priority: 'normal' }
    budget DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    priority VARCHAR(20) DEFAULT 'normal',
    prompt TEXT,  -- 给 OpenClaw 的指令
    workspace_id VARCHAR(100),
    created_by UUID NOT NULL,
    assigned_to UUID,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- 工作者表（新增）
CREATE TABLE workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    status VARCHAR(20) DEFAULT 'offline',  -- 'online' | 'busy' | 'offline'
    current_task_id UUID,
    skills JSONB,  -- [{ tag: 'coding', proficiency: 'expert' }]
    rating DECIMAL(3,2) DEFAULT 0,
    hourly_rate DECIMAL(12,2),
    completed_tasks INT DEFAULT 0,
    failed_tasks INT DEFAULT 0,
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- OpenClaw 实例注册表（新增）
CREATE TABLE openclaw_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    url VARCHAR(500) NOT NULL,
    token VARCHAR(255) NOT NULL,
    assistant_id VARCHAR(100),
    capabilities JSONB,
    status VARCHAR(20) DEFAULT 'offline',
    current_task_id UUID,
    load_factor DECIMAL(5,2) DEFAULT 0,
    registered_at TIMESTAMP DEFAULT NOW(),
    last_heartbeat TIMESTAMP
);
```

### 3.5 API 扩展

```typescript
// 任务 API - 创建任务
POST /api/v1/tasks
{
  title: string;
  description: string;
  requirements: {
    skills: string[];
    deadline?: number;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
  };
  budget: number;
  prompt: string;  // 给 OpenClaw 的具体指令
}

// 任务 API - 抢单
POST /api/v1/tasks/:id/accept

// 任务 API - 提交结果
POST /api/v1/tasks/:id/submit
{ result: string; }

// 任务 API - 确认完成
POST /api/v1/tasks/:id/complete

// 工作者 API - 注册
POST /api/v1/workers/register
{
  userId: string;
  skills: Array<{ tag: string; proficiency: string }>;
  hourlyRate: number;
}

// 工作者 API - 更新状态
PUT /api/v1/workers/:id/status
{ status: 'online' | 'busy' | 'offline'; }

// OpenClaw 实例 API - 注册
POST /api/v1/openclaw/instances
{
  url: string;
  token: string;
  assistantId?: string;
}

// OpenClaw 实例 API - 心跳
POST /api/v1/openclaw/instances/:id/heartbeat
```

---

## 四、实施路线（已全部实现 ✅）

### Phase 1：基础功能 ✅

- [x] 扩展数据库 Schema（tasks, workers, openclaw_instances）
- [x] 实现 OpenClawClusterManager (`services/openclaw-cluster.ts`)
- [x] 实现基础任务调度 (`services/task-queue.ts`)
- [x] 技能匹配算法 (`methods/tasks.ts`)

### Phase 2：交易闭环 ✅

- [x] 支付网关集成（模拟已实现）
- [x] 佣金结算逻辑 (8%-15% 阶梯佣金)
- [x] 钱包完整功能 (`methods/marketplace.ts`)
- [x] 提现流程 (`/api/wallet/withdraw`)

### Phase 3：实时体验 ✅

- [x] WebSocket 实时通知 (`services/realtime-events.ts`)
- [x] 任务状态推送
- [x] 新任务推送

### Phase 4：生产就绪 ✅

- [x] 多租户隔离（tenant 架构）
- [x] 完整用户认证（tenant_users 关联）
- [ ] 监控/日志（可选）
- [ ] 限流/熔断（可选）

---

## 五、配置示例

### 5.1 环境变量

```bash
# Gateway
AIFC_GATEWAY_PORT=3001
AIFC_GATEWAY_WS_PATH=/ws

# Database
DATABASE_URL=postgresql://user:pass@host:5432/aifc

# Redis（任务队列）
REDIS_URL=redis://localhost:6379

# OpenClaw 集群（云端）
OPENCLAW_CLUSTER_ENABLED=true
OPENCLAW_CLUSTER_URLS=ws://openclaw-1:18789,ws://openclaw-2:18789
OPENCLAW_CLUSTER_TOKENS=token1,token2

# 支付
ESCROW_CONTRACT_ADDRESS=0x...
ESCROW_PRIVATE_KEY=0x...
DEFAULT_COMMISSION_RATE=0.10
```

### 5.2 Docker Compose

```yaml
version: '3.8'
services:
  gateway:
    build: ./backend/gateway
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/aifc
      - REDIS_URL=redis://redis:6379
      - OPENCLAW_CLUSTER_ENABLED=true
      - OPENCLAW_CLUSTER_URLS=ws://openclaw-1:18789,ws://openclaw-2:18789
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:14
    environment:
      POSTGRES_PASSWORD: password
      POSTGRES_DB: aifc
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine

  openclaw-1:
    image: openclaw/openclaw:latest
    environment:
      - AGENT_ID=worker-001
      - TOKEN=${WORKER_TOKEN_1}

  openclaw-2:
    image: openclaw/openclaw:latest
    environment:
      - AGENT_ID=worker-002
      - TOKEN=${WORKER_TOKEN_2}

  task-worker:
    build: ./backend/task-worker
    depends_on:
      - gateway
      - redis

volumes:
  pgdata:
```

---

## 六、总结

| 模块 | 当前状态 | 目标 |
|------|----------|------|
| OpenClaw 接入 | 本地直连 | 云端集群 |
| 任务管理 | 无 | 完整的任务生命周期 |
| 工作者 | 无注册 | 技能匹配+智能派发 |
| 交易 | 基础 CRUD | 支付+佣金+结算 |
| 实时性 | 轮询 | WebSocket 推送 |
| 多租户 | 硬编码 | 完整隔离 |

本方案保持了与现有代码的兼容性，可以逐步迁移实现。