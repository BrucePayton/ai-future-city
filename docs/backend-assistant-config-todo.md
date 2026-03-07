# 后端：AI 助手配置接口开发待办清单

本文档面向 **ai-future-city 后端（gateway）**，为实现前端「编辑配置」功能并令配置持久化生效而需要增加的接口与落地步骤。前端将提供**单页助手配置页**与保存流程，待后端提供以下能力后即可对接。

**相关前端**：AIFutureCity-Web/Aifuturecity  
- **编辑入口**：AI 助手管理 → 详情 →「编辑配置」；或列表卡片「编辑」、操作菜单「编辑配置」  
- **配置页路由**：`/dashboard/assistants/:id/config`（单页，仅 Persona / Tools / 约束 / 成本四块，无设备选择与连接步骤）  
- **契约参考**：[frontend-api-contract.md](./frontend-api-contract.md)  
- **前端规划**：编辑配置改为单页助手配置；前端数据层将去除 mock 前缀命名（如 `assistantDetails`、`skills`、`tools` 等），配置页加载时优先 `GET /api/assistants/:id/config`，未实现时用本地兜底数据预填。

---

## 一、目标与范围

- **目标**：支持前端对已登记助手的「配置」进行查看与更新，并令配置在任务派发、成本控制、约束校验等环节生效。
- **配置维度**（与前端单页配置页一致，对应「接入新助手」向导中的步骤 3–6）：
  - **Persona**：角色、描述、核心职责、技能标签（或 Markdown 描述文本）
  - **Tools**：挂载工具 ID 列表及是否需审批
  - **Constraints**：拒绝规则（deny tags）列表及严重级别
  - **CostControl**：月度 Token 上限、成本预警阈值、最低接单价格等

---

## 二、接口清单与契约

### 2.1 获取助手配置

| 项 | 说明 |
|----|------|
| 方法/路径 | `GET /api/assistants/:id/config` |
| 用途 | 单页配置页（`.../config`）加载时预填表单；详情抽屉展示扩展配置 |
| 路径参数 | `id`：助手唯一标识（与 `GET /api/assistants` 返回的 `id` 一致） |

**响应**（200）：

```json
{
  "id": "my-pc-001",
  "name": "我的电脑",
  "persona": {
    "role": "全栈软件工程师",
    "description": "擅长 TypeScript/Python 系统设计与代码实现…",
    "coreResponsibilities": ["需求拆解与技术方案设计", "核心代码编写与单元测试"],
    "skillTags": ["TypeScript", "Python", "Architecture", "Code Review"]
  },
  "tools": [
    { "id": "code_exec", "name": "代码执行", "category": "compute", "requiresApproval": false },
    { "id": "web_search", "name": "Web 搜索", "category": "compute", "requiresApproval": false }
  ],
  "constraints": [
    { "rule": "generate-malware", "severity": "critical" },
    { "rule": "expose-credentials", "severity": "critical" }
  ],
  "costControl": {
    "monthlyTokenLimitM": 50,
    "tokenUsedThisMonthM": 32.4,
    "costWarningETH": 0.1,
    "minAcceptPrice": 0.01
  }
}
```

- 若助手存在但未配置过：可返回上述结构，字段为空数组或默认值。
- **404**：`id` 对应助手不存在时返回。

---

### 2.2 更新助手配置

| 项 | 说明 |
|----|------|
| 方法/路径 | `PATCH /api/assistants/:id/config` 或 `PUT /api/assistants/:id/config` |
| 用途 | 单页配置页「保存配置」按钮提交后持久化 |
| 路径参数 | `id`：助手唯一标识 |
| Body | `Content-Type: application/json`，见下 |

**请求体示例**：

```json
{
  "name": "我的电脑",
  "persona": {
    "role": "全栈软件工程师",
    "description": "擅长 TypeScript/Python…",
    "coreResponsibilities": ["需求拆解与技术方案设计", "核心代码编写与单元测试"],
    "skillTags": ["TypeScript", "Python", "Architecture"]
  },
  "tools": [
    { "id": "code_exec", "requiresApproval": false },
    { "id": "web_search", "requiresApproval": false }
  ],
  "constraints": [
    { "rule": "generate-malware", "severity": "critical" },
    { "rule": "expose-credentials", "severity": "critical" }
  ],
  "costControl": {
    "monthlyTokenLimitM": 50,
    "costWarningETH": 0.1,
    "minAcceptPrice": 0.01
  }
}
```

- 建议采用**部分更新**（PATCH）：仅提交的字段覆盖，未提交字段保留原值；若采用 PUT，可约定「未传字段置为默认或空」。

**响应**（200）：

```json
{
  "ok": true,
  "id": "my-pc-001"
}
```

**错误**：

- **400**：body 校验失败，如 `{ "ok": false, "error": "..." }`。
- **404**：助手不存在。

---

## 三、后端落地步骤（建议顺序）

1. **数据模型与存储**
   - [x] 为「助手配置」定义存储结构（或复用现有 device/assistant 模型扩展字段）。
   - [x] 确定存储位置：网关内存（`AssistantConfigStore`）、独立配置文件、或下游服务/DB；若网关无状态，需可持久化存储或同步到 OpenClaw/设备侧。

2. **GET /api/assistants/:id/config**
   - [x] 在 gateway 中新增路由，根据 `id` 解析助手（来自已登记设备或 OpenClaw 代理）。
   - [x] 若本地/下游有该助手的配置，返回 2.1 约定结构；否则返回带默认值的结构（助手不存在时 404）。
   - [x] 与 `GET /api/assistants` 的 `id` 来源一致（登记列表 + OpenClaw 合并列表）。

3. **PATCH /api/assistants/:id/config**
   - [x] 新增路由，解析 body（persona / tools / constraints / costControl）。
   - [x] 校验 `id` 对应助手是否存在（已登记或 OpenClaw 代理）。
   - [x] 将配置写入存储；若配置需下发到设备或 OpenClaw，在此或异步任务中完成同步。
   - [x] 返回 `{ ok: true, id }`。

4. **配置生效**
   - [ ] **任务派发 / 聊天**：派发任务或聊天时，根据 `assistantId` 加载其配置（tools、persona），下发给执行端或 OpenClaw。
   - [ ] **约束校验**：在执行或工具调用前，按该助手的 `constraints` 做拒绝规则校验。
   - [ ] **成本控制**：按 `costControl` 做 Token 上限、预警与最低接单价校验（若业务需要）。

5. **（可选）WebSocket RPC**
   - [ ] 若希望前端通过 WS 拉取/更新配置，可扩展 `assistants.getConfig`、`assistants.updateConfig`，与 HTTP 接口同构。

---

## 四、前端对接约定（后端就绪后）

- 前端**单页配置页**（路由 `dashboard/assistants/:id/config`，组件 AssistantConfigPage）：
  - **加载**：调用 `GET /api/assistants/:id/config` 预填表单；若返回 404 或接口未实现，前端用本地兜底数据（如 `assistantDetails[id]`）预填。
  - **保存**：用户点击「保存配置」时调用 `PATCH /api/assistants/:id/config`，body 与 2.2 一致；成功则跳回助手列表，失败则展示错误。
- 前端网关客户端已预留：`getAssistantConfig(id)`、`updateAssistantConfig(id, body)`，见 [frontend-api-contract.md](./frontend-api-contract.md) 的扩展约定。
- 前端数据层命名已与规划同步：静态/兜底数据导出已去除 mock 前缀（如 `assistantDetails`、`skills`、`tools`），仅用于接口未就绪时的预填与展示。

---

## 五、快速参考

| 能力         | 方法/路径                          | 说明           |
|--------------|------------------------------------|----------------|
| 获取助手配置 | `GET /api/assistants/:id/config`   | 编辑预填、详情 |
| 更新助手配置 | `PATCH /api/assistants/:id/config` | 保存编辑       |

完成上述接口并令配置在任务/约束/成本环节生效后，前端的「编辑配置」流程（详情/列表 → 单页配置页 → 保存）即可端到端打通。
