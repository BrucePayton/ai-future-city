# 训练场 API 迭代方向

本文档列出训练场后端可进一步完善的方向，供后续迭代参考。当前 B1/B3/B4/B5/B7/B8/B10 已实现，前端已对接。

---

## 一、B1 聊天能力评估 - LLM 接入

**现状**：规则引擎（关键词、长度、persona 一致性）

**改进**：
- 接入 LLM 或 knowledge-service，对回复进行语义评估
- 将 persona、constraints 作为 prompt，让模型判断回复是否体现角色、人格、约束
- 支持可配置的通过阈值（默认 80）

---

## 二、B4 工具测试执行 - 沙箱接入

**现状**：Stub 模拟，仅对少数工具（code_exec、web_search 等）返回固定结果

**改进**：
- 接入真实工具执行沙箱（E2B / 自建沙箱）
- 对 code_exec：执行预定义测试代码，校验输出
- 对 web_search：调用真实搜索 API，校验返回非空
- 对 file_read_write：读写临时文件，校验内容
- MCP 工具：通过 MCP Server 执行真实调用并校验

---

## 三、B6 测试用例库

**现状**：`EXEC_TEST_STUBS` 中仅定义少量工具

**改进**：
- 为各工具定义标准测试用例（输入、期望输出、超时）
- 支持按工具类型扩展测试用例
- 支持用户自定义测试用例（可选）

---

## 四、B7 任务理解与拆解 - LLM 接入

**现状**：固定返回 s1/s2/s3 子任务

**改进**：
- 接入 LLM，根据任务描述生成 summary、constraints、deliverables、subtasks
- 可结合 Weaviate/RAG 检索相似任务拆解模式
- 支持按任务类型（开发、数据、审计等）调整拆解策略

---

## 五、B8 工具调用链生成 - 智能映射

**现状**：按 s1/s2/s3 预设映射到 web_search、code_exec、file_read_write

**改进**：
- 根据子任务描述与助手可用工具，LLM 或规则匹配推荐工具
- 结合 evomapGenomes 中的 strategies 推荐调用顺序
- 考虑工具依赖关系（如 file_read_write 依赖 code_exec 产出）

---

## 六、B9 助手关联任务列表（可选）

**接口**：`GET /api/assistants/:id/tasks`

**说明**：返回该助手已承接或正在执行的任务列表，供任务完成能力训练选择。可从 workspace/session 数据中聚合。

**优先级**：P2

---

## 七、B11 训练会话管理（可选）

**接口**：
- `POST /api/assistants/:id/training/sessions`：创建训练会话
- `GET /api/assistants/:id/training/sessions/:sessionId`：获取会话详情

**说明**：支持多轮训练会话的持久化与回放。

**优先级**：P2

---

## 八、错误响应统一

**现状**：404 返回 `{ ok: false, error: "Assistant not found" }`

**改进**：
- 统一错误响应格式：`{ ok: false, error: string, code?: string }`
- 4xx 时前端可解析并展示用户可理解的提示
- 5xx 时提示「服务暂时不可用，请稍后重试」
