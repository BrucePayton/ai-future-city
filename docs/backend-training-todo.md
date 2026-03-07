# 训练场后端开发待办清单

本文档列出训练场模块需要后端协助的 API 与能力，供后端团队实现与排期。

---

## 一、聊天能力相关

### B1 聊天能力评估

**接口**: `POST /api/assistants/:id/training/chat/evaluate`

**请求体**:
```json
{
  "messages": [
    { "role": "user", "content": "请介绍一下你自己" },
    { "role": "assistant", "content": "我是全栈软件工程师..." }
  ]
}
```

**响应体**:
```json
{
  "passed": true,
  "score": 85,
  "suggestions": []
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| passed | boolean | 是否通过（角色/人格/约束体现合格） |
| score | number | 0-100 得分 |
| suggestions | string[] | 改进建议（未通过时） |

**实现建议**: 使用 LLM 或规则引擎，比对助手 persona 配置与回复内容，判断角色一致性、人格一致性、约束 adherence。

---

### B2 评估规则/模型配置

**能力**: 角色一致性、人格一致性、约束 adherence 的判定逻辑。

**实现建议**:
- 规则引擎：关键词匹配、正则
- LLM 评估：将 persona 与 constraints 作为 prompt，对回复进行打分
- 建议配置阈值：score >= 80 为 passed

---

## 二、执行能力相关

### B3 获取助手工具清单

**接口**: `GET /api/assistants/:id/tools`

**响应体**:
```json
[
  { "id": "code_exec", "name": "代码执行", "category": "compute", "source": "native" },
  { "id": "mcp_01:create_pull_request", "name": "创建 PR", "category": "code", "source": "mcp" }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 工具 ID（native 工具或 MCP:tool 组合） |
| name | string | 显示名称 |
| category | string | 分类：compute / data / vision / blockchain 等 |
| source | string | 来源：native / mcp / skill |

**实现建议**: 合并 `AssistantConfigPayload.tools` 与 MCP、Skills 映射得到的工具列表。

---

### B4 工具测试执行

**接口**: `POST /api/assistants/:id/training/exec/test`

**请求体**:
```json
{ "toolId": "code_exec" }
```

**响应体**:
```json
{
  "toolId": "code_exec",
  "toolName": "代码执行",
  "passed": true,
  "durationMs": 45,
  "error": null
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| passed | boolean | 测试是否成功 |
| durationMs | number | 执行耗时 |
| error | string | 失败时错误信息 |

**实现建议**: 在沙箱环境中执行预定义测试用例（见 B6），调用对应工具并校验输出。

---

### B5 工具调用灌输

**接口**: `POST /api/assistants/:id/training/exec/inject`

**请求体**:
```json
{
  "toolId": "code_exec",
  "schema": "code_exec(language: string, code: string) -> { output: string }",
  "examples": ["调用 code_exec 执行 print(1+1) 的示例"]
}
```

**响应体**:
```json
{ "ok": true }
```

**实现建议**: 将工具 Schema 与 Few-Shot 示例注入助手的系统 Prompt 或知识库，使助手无需自主学习即可按规范调用。

---

### B6 测试用例库

**能力**: 各工具标准测试用例。

**示例**:
- `code_exec`: 执行 `print(1+1)` 或等价代码，预期输出 `2`
- `web_search`: 搜索固定关键词，预期返回非空结果
- `file_read_write`: 读/写临时文件，校验内容
- MCP 工具：按 MCP Server 提供的 tools 定义对应测试

**优先级**: P1

---

## 三、任务完成能力相关

### B7 任务理解与拆解

**接口**: `POST /api/assistants/:id/training/task/analyze`

**请求体**:
```json
{
  "taskDescription": "开发一个 Python 贪吃蛇游戏，包含计分系统和单元测试"
}
```

**响应体**:
```json
{
  "summary": "开发 Python 贪吃蛇游戏，需计分与测试",
  "constraints": ["代码需通过单元测试", "遵循平台约束"],
  "deliverables": ["可运行代码", "测试用例"],
  "subtasks": [
    { "id": "s1", "description": "需求分析与技术方案", "dependsOn": [] },
    { "id": "s2", "description": "核心逻辑实现", "dependsOn": ["s1"] },
    { "id": "s3", "description": "单元测试与文档", "dependsOn": ["s2"] }
  ]
}
```

**实现建议**: 使用 LLM 对任务描述进行结构化拆解，可结合 EvoMap 经验库（Weaviate/RAG）推荐相似任务拆解模式。

---

### B8 工具调用链生成

**接口**: `POST /api/assistants/:id/training/task/chain`

**请求体**:
```json
{
  "taskId": "task_001",
  "subtasks": [
    { "id": "s1", "description": "需求分析与技术方案" },
    { "id": "s2", "description": "核心逻辑实现" },
    { "id": "s3", "description": "单元测试与文档" }
  ]
}
```

**响应体**:
```json
{
  "steps": [
    { "subtaskId": "s1", "toolId": "web_search", "toolName": "Web 搜索", "inputHint": "查找贪吃蛇 Python 实现最佳实践" },
    { "subtaskId": "s2", "toolId": "code_exec", "toolName": "代码执行", "inputHint": "实现蛇移动、食物生成、碰撞检测" },
    { "subtaskId": "s3", "toolId": "file_read_write", "toolName": "文件读写", "inputHint": "编写 test_snake.py 并执行" }
  ]
}
```

**实现建议**: 根据子任务描述与助手可用工具，LLM 或规则匹配推荐工具及调用顺序。可结合 evomapGenomes 中的 strategies。

---

### B9 助手关联任务列表（可选）

**接口**: `GET /api/assistants/:id/tasks`

**响应体**:
```json
[
  { "id": "task_001", "title": "开发贪吃蛇游戏", "description": "...", "status": "in_progress" }
]
```

**优先级**: P2

---

## 四、训练场通用

### B10 训练进度存储

**接口**:
- `GET /api/assistants/:id/training/progress`
- `POST /api/assistants/:id/training/progress`

**GET 响应体**:
```json
{
  "chat": { "score": 85, "lastEvaluatedAt": "2026-03-07T10:00:00Z" },
  "exec": { "passRate": 90, "toolResults": [...] },
  "task": { "analyzedCount": 3 }
}
```

**POST 请求体**: 与 GET 响应结构一致，用于更新进度。

**优先级**: P1

---

### B11 训练会话管理（可选）

**接口**:
- `POST /api/assistants/:id/training/sessions`：创建训练会话
- `GET /api/assistants/:id/training/sessions/:sessionId`：获取会话详情

**优先级**: P2

---

## 五、优先级与建议排期

| 序号 | 待办项 | 优先级 | 建议排期 |
|------|--------|--------|----------|
| B1 | 聊天能力评估 | P0 | 第 1 迭代 |
| B2 | 评估规则/模型配置 | P0 | 第 1 迭代 |
| B3 | 获取助手工具清单 | P0 | 第 1 迭代 |
| B4 | 工具测试执行 | P0 | 第 1 迭代 |
| B5 | 工具调用灌输 | P0 | 第 1 迭代 |
| B7 | 任务理解与拆解 | P0 | 第 1 迭代 |
| B8 | 工具调用链生成 | P0 | 第 1 迭代 |
| B6 | 测试用例库 | P1 | 第 2 迭代 |
| B10 | 训练进度存储 | P1 | 第 2 迭代 |
| B9 | 助手关联任务列表 | P2 | 第 3 迭代 |
| B11 | 训练会话管理 | P2 | 第 3 迭代 |

---

## 六、依赖项

- **LLM**: 聊天评估、任务拆解、工具链生成需 LLM 能力（如 OpenAI / Claude / 自托管模型）
- **Weaviate / RAG**: 任务拆解与工具链生成可结合 EvoMap 经验库
- **工具执行沙箱**: 执行 code_exec、file_read_write 等需安全沙箱
- **MCP 桥接**: 测试 MCP 工具需与 MCP Server 建立连接并执行工具调用
