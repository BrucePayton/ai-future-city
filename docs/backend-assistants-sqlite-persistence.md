# 网关助手状态：SQLite 本地持久化（实现说明）

本文档说明 **ai-future-city 网关（`backend/gateway`）** 在无 PostgreSQL 时，如何将「助手配置 + 登记设备 + 列表状态」落盘到 **SQLite**，以及设计动机与使用方式。对应待办清单中的「助手配置存储结构」落地，并与现有 PostgreSQL / JSON 路径并列。

**相关文档**：[backend-assistant-config-todo.md](./backend-assistant-config-todo.md)（接口与产品范围）、[backend-assistant-config-enforcement.md](./backend-assistant-config-enforcement.md)（配置在任务/约束/成本上的生效方式）。

---

## 一、为什么要这么做

1. **明确「存储结构」而不只停留在内存**  
   助手配置（Persona、Tools、Constraints、CostControl）与登记设备、隐藏/下架 ID 需要可恢复的持久化，才能满足「编辑配置 → 保存 → 重启网关后仍生效」以及多进程/部署演进时的预期。

2. **本地开发默认用 SQLite，而不是整文件 JSON**  
   原先无 `DATABASE_URL` 时仅写 `data/assistants.json`。单文件 JSON 在并发写入、部分更新、与关系型查询习惯上都不如 SQLite 清晰；SQLite 单文件、零外部服务，适合作为 **本地与小型部署的默认落盘**，语义上又与生产环境 PostgreSQL 的「快照表」对齐，降低心智负担。

3. **与 PostgreSQL 路径同构，便于切换**  
   PostgreSQL 侧已有 `assistants_devices`、`assistant_configs`、`assistant_hidden_ids`、`assistant_delisted_ids` 等表及 `persistence-pg.ts` 的整包读写。SQLite 采用 **相同的逻辑数据模型**（配置大块字段用 JSON 文本列），网关仍只操作内存中的 `DeviceManager` / `AssistantConfigStore` 等，持久化层负责序列化，避免两套业务规则。

4. **选用 Node 内置 `node:sqlite`，避免原生扩展依赖**  
   曾考虑 `better-sqlite3`，但在较新 Node 版本上可能缺少预编译二进制、需本机编译。改用 **`node:sqlite`（Node 22+）** 可去掉额外 npm 依赖与原生模块构建问题；代价是运行时可能出现 **ExperimentalWarning**（见下文「已知限制」）。

---

## 二、本次实现了什么

| 类别 | 内容 |
|------|------|
| 持久化模块 | `backend/gateway/src/db/persistence-sqlite.ts`：建表、`load` / `save` / `close`，事务内替换各表数据（与 PG 的「删租户下全表再插入」策略一致）。 |
| 类型补充 | `backend/gateway/src/types/node-sqlite.d.ts`：为尚未完全进入 `@types/node` 的 `node:sqlite` 提供最小声明，保证 `tsc` 通过。 |
| 启动接线 | `backend/gateway/src/index.ts`：在 **无 `DATABASE_URL`** 时默认打开 SQLite；`persistAssistantsData` 与 HTTP/WS 共用同一套快照写入；`SIGINT` 时 `close()` 数据库连接。 |
| 配置说明 | `backend/gateway/src/config/env.ts` 中对 `databaseUrl` 的注释更新，说明 SQLite / JSON / PG 的分支。 |
| 清单与生效说明 | `docs/backend-assistant-config-todo.md`、`docs/backend-assistant-config-enforcement.md` 中补充默认 SQLite、环境变量及持久化回调描述。 |

**未引入**新的 npm 依赖（不使用 `better-sqlite3`）。

---

## 三、SQLite 里存什么（表结构概要）

逻辑上与 `persistence-pg.ts` 的「助手相关快照」一致：

- **`assistants_devices`**：已登记设备 `id`、`kind`、`status`、`last_seen_at`、`name` 等。  
- **`assistant_configs`**：每个助手一行；`persona`、`tools`、`constraints`、`cost_control` 为 **JSON 文本**（与 PG 的 JSONB 字段一一对应）；`chat_evaluate_pass_threshold` 可选。  
- **`assistant_hidden_ids` / `assistant_delisted_ids`**：助手列表展示用隐藏、下架 ID 集合。  

当前使用固定逻辑租户键 `tenant_id = 'default'`（单租户占位，与 PG 多租户扩展前的用法一致）。

---

## 四、作用与运行时行为

1. **启动**  
   - 若配置了 **`DATABASE_URL`**：行为不变，仍用 PostgreSQL + `persistence-pg.ts`。  
   - 否则若设置 **`AIFC_ASSISTANTS_USE_JSON=1`（或 `true`/`yes`）**：仅读写 **`AIFC_ASSISTANTS_DATA_PATH`**（默认 `data/assistants.json`），与改造前一致。  
   - **默认**：使用 **`AIFC_ASSISTANTS_SQLITE_PATH`**（默认 `data/assistants.sqlite`），通过 `openAssistantsSqlitePersistence` 加载。

2. **从 JSON 的一次性迁移**  
   若 SQLite 库为空或无任何行，且存在 **`jsonFallbackPath`**（启动时传入为 `AIFC_ASSISTANTS_DATA_PATH` 指向的文件），则从该 JSON **读取整包状态并写入 SQLite**，之后以 SQLite 为准。便于老环境从 `assistants.json` 平滑过渡。

3. **写入时机**  
   与原先一致：HTTP/WS 在变更助手相关状态后调用 **`persistAssistantsData`**，将当前内存快照写入 SQLite（或 JSON / PG）。配置策略与接口行为见 [backend-assistant-config-enforcement.md](./backend-assistant-config-enforcement.md)。

---

## 五、环境变量速查

| 变量 | 含义 |
|------|------|
| `DATABASE_URL` | 若设置：PostgreSQL 持久化，**不**走 SQLite 默认分支。 |
| `AIFC_ASSISTANTS_USE_JSON` | 为 `1` / `true` / `yes` 时：强制仅用 JSON 文件。 |
| `AIFC_ASSISTANTS_SQLITE_PATH` | SQLite 文件路径；默认 `data/assistants.sqlite`。 |
| `AIFC_ASSISTANTS_DATA_PATH` | JSON 路径（迁移源 + `USE_JSON` 模式下的主文件）；默认 `data/assistants.json`。 |

---

## 六、已知限制与运维提示

- **`node:sqlite` 实验性**：Node 可能打印 `ExperimentalWarning: SQLite is an experimental feature`。功能上已可用于当前网关读写；若未来 API 变更，需跟随 Node 发行说明调整。  
- **Node 版本**：建议 **Node 22+**（内置 `node:sqlite`）。  
- **空字符串 `DATABASE_URL`**：在 JavaScript 中空字符串为真值，可能被当作「已配置数据库」；部署时应 **未设置该变量** 或设为有效连接串，避免误连。  
- **本地/CI 产物**：`data/assistants.sqlite` 及 `-wal` / `-shm` 为运行时生成，是否纳入版本控制由团队约定；集成测试可使用独立路径（例如临时目录下的 `.sqlite` 文件）。

---

## 七、验证建议（可选）

在 `backend/gateway` 下执行 `pnpm run build` 后，在无 `DATABASE_URL` 的前提下指定端口与 SQLite 路径启动 `node dist/index.js`，检查：

- 日志出现 `Using SQLite assistants persistence at ...`；  
- `GET /api/assistants`、`GET /api/assistants/:id/config` 返回 200；  
- `PATCH /api/assistants/:id/config` 返回 `{"ok":true,"id":...}` 且重启后配置仍在。

---

## 八、代码入口索引

- SQLite 实现：`backend/gateway/src/db/persistence-sqlite.ts`  
- PostgreSQL 对照：`backend/gateway/src/db/persistence-pg.ts`  
- JSON 对照：`backend/gateway/src/assistants/persistence.ts`  
- 启动与持久化回调：`backend/gateway/src/index.ts`
