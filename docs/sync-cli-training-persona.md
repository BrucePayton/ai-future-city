# 训练场人格配置与 sync-cli 同步

训练场对话与接入流程正常，但服务端在「编辑配置」里维护的 **Persona/人格配置** 不会自动写入本机 OpenClaw 的 `~/.openclaw`，因此训练场对话时 OpenClaw 仍使用本地 SOUL.md 等，人格与平台不一致。

通过 **sync-cli** 将网关配置同步到与 `~/.openclaw` **平行** 的目录 `~/.aifuturecity`，既不修改用户原有配置，又能在接入训练场时使用平台人格（需配合下文「生效方式」）。

---

## 一、使用 sync-cli 同步配置

### 1. 安装与构建

在 **ai-future-city** 仓库根目录：

```bash
pnpm install
pnpm --filter @aifc/sync-cli build
```

### 2. 首次配置（init）

运行交互式配置，按提示输入：

- **Gateway base URL**：网关地址，如 `http://localhost:3001`
- **Assistant ID**：与网关中已登记的助手 ID 一致（如 OpenClaw 接入时的 deviceId，例如 `local-openclaw-001`）
- **本地 AI 助手配置路径**：本机 OpenClaw 配置目录，如 `~/.openclaw`（仅用于检测，**不会修改**）
- **平行配置路径**：默认 `~/.aifuturecity`，可覆盖

配置会写入 `~/.aifuturecity/sync-config.json`。

```bash
pnpm --filter @aifc/sync-cli run init
```

或：`node client/sync-cli/dist/cli.js init`

### 3. 拉取并写盘

- **单次同步**：从网关拉取当前助手配置，并写入 `~/.aifuturecity` 下的 SOUL.md、IDENTITY.md、USER.md、AGENTS.md、TOOLS.md：

  ```bash
  pnpm --filter @aifc/sync-cli run once
  ```

- **持续同步**：保持与网关的 WebSocket 心跳，并定时轮询配置（默认 30s）；一旦发现配置变更则自动写盘：

  ```bash
  pnpm --filter @aifc/sync-cli run sync
  ```

  或：`node client/sync-cli/dist/cli.js once` / `node client/sync-cli/dist/cli.js run`

建议在需要训练场人格与平台一致时，先运行一次 `once` 或长期运行 `run`，再启动 OpenClaw 并接入训练场。

### 4. 助手在线状态与 Inbound Bridge

**仅运行 sync-cli 不会让助手在网关列表中显示为「在线」**。sync-cli 的职责是配置同步与可选启动 OpenClaw，**不**负责连接网关的 WebSocket 注册。

要让 OpenClaw 助手在网关中显示为**在线**且可使用训练场对话，需要额外运行 **Inbound Bridge**（OpenClaw 主动连网关并注册）。例如在 `client/openclaw-adapter` 目录下执行：

```bash
pnpm run bridge:inbound
```

并配置环境变量（与 sync-config 的 `assistantId` 一致）：

- **GATEWAY_WS_URL**：网关 Inbound WebSocket 地址，如 `ws://localhost:3001/ws/openclaw-inbound`
- **OPENCLAW_INBOUND_TOKEN**：与网关的 `OPENCLAW_INBOUND_TOKEN`（或 `OPENCLAW_LOCAL_TOKEN`）一致
- **OPENCLAW_GATEWAY_ASSISTANT_ID**：与 sync-config 中的 `assistantId` 一致，如 `local-openclaw-001`

若在 `aifc-sync init` 时选择「Launch Inbound Bridge with sync」，则运行 `aifc-sync run` 时会一并启动 Bridge（需设置 `OPENCLAW_INBOUND_TOKEN` 或 `OPENCLAW_LOCAL_TOKEN`）；否则需单独运行上述 Bridge。

---

## 二、同步生成的文件

| 文件        | 作用               | 与服务端映射 |
|-------------|--------------------|--------------|
| SOUL.md     | 核心人格、行为     | 由服务端 `persona`（role、description、coreResponsibilities、skillTags）生成 |
| IDENTITY.md | 身份元数据         | 由服务端 `name`、persona.role 等生成 |
| USER.md     | 关于「你」的信息   | 占位/扩展    |
| AGENTS.md   | 工作方式与规范     | 占位/扩展    |
| TOOLS.md    | 工具与约束         | 由服务端 `tools`、`constraints` 生成 |

编辑人格请在前端「编辑配置」或通过网关 `PATCH /api/assistants/:id/config` 修改；sync-cli 负责将最新配置同步到 `~/.aifuturecity`，**不要**直接改 `~/.aifuturecity` 内与平台同步的文件（会被下次同步覆盖）。

---

## 三、让接入的 AI 助手使用平台人格

同步到 `~/.aifuturecity` 后，需让 OpenClaw 在**接入平台 / 训练场**时从 `~/.aifuturecity` 读人格（SOUL.md、IDENTITY.md 等），而不是从 `~/.openclaw` 读。推荐用环境变量覆盖状态目录。

### 为什么训练场里测试还是本地人格？

训练场「聊天能力」的请求链路是：**前端 → 网关 → 当前与网关相连的 OpenClaw 进程**。回复由**这一个** OpenClaw 进程生成，它用的是**自己启动时**读到的配置（SOUL.md 等来自哪个目录，由启动时是否设置 `OPENCLAW_STATE_DIR` 决定）。

因此：

- 若你先**单独启动了 OpenClaw**（没设 `OPENCLAW_STATE_DIR`），网关已经连上了这个实例，它一直用 `~/.openclaw`，所以训练场回复是**本地人格**。
- 之后你再开 sync-cli 并启用「随 sync 启动 OpenClaw」，sync-cli 会再起一个 OpenClaw（平台人格），但网关**仍然连着先前的那个**；若两个都占同一端口，后起的还可能起不来。所以训练场依旧走的是先启动的本地人格实例。

**正确做法**：要让训练场用**平台人格**，**与网关通信的那一个 OpenClaw 必须是用 `OPENCLAW_STATE_DIR=~/.aifuturecity` 启动的**。推荐顺序：

1. **不要先单独启动 OpenClaw**。先启动网关（`pnpm dev:backend`），再启动 **sync-cli run**（且 init 时已选「Launch OpenClaw with platform persona when running sync」）。这样由 sync-cli 启动的 OpenClaw 是唯一在跑的实例，网关（出站）会连上它，训练场即使用平台人格。
2. 或者：先在一个终端里 `export OPENCLAW_STATE_DIR="$HOME/.aifuturecity"` 再 `openclaw`，**然后**再启动网关，让网关连上这个实例。

若你之前已经先起了 OpenClaw，请先关掉它，再按上面顺序用「平台人格实例」先起、再起网关。

### 方式 1（推荐）：配置时勾选「随 sync 启动 OpenClaw」，退出即恢复

在 **`aifc-sync init`** 时选择「Launch OpenClaw with platform persona when running sync? (y/N)」填 **y**，并填写 OpenClaw 启动命令（如 `openclaw` 或 `npx openclaw`）。配置会写入 `~/.aifuturecity/sync-config.json`。

之后运行 **`aifc-sync run`** 时，sync-cli 会：

- **先从网关拉取助手配置并写入 ~/.aifuturecity**（SOUL.md、IDENTITY.md、USER.md、AGENTS.md、TOOLS.md），即平台人格；若首次同步失败（如网关未启动），会重试最多 5 次再启动 18790，避免 18790 在无人格文件时启动导致训练场用占位内容。**请先启动网关再运行 sync-cli**，以保证人格先同步再起实例。
- 照常做配置同步与心跳；
- **自动以子进程启动 OpenClaw**，执行 `openclaw gateway --port <平台端口>`，并为该子进程设置 `OPENCLAW_STATE_DIR=~/.aifuturecity` 与 `OPENCLAW_CONFIG_PATH=~/.aifuturecity/openclaw.json`，因此该实例使用平台人格并监听 18790；
- **从本机 OpenClaw 配置目录（如 ~/.openclaw）合并大模型相关配置**：将 `openclaw.json`（或 `config.json5`）中的 `models`、`env`、`agents` 写入 `~/.aifuturecity/openclaw.json`，并将 `agents/main/agent/auth-profiles.json` 复制到 `~/.aifuturecity/agents/main/agent/`，使训练场中的平台实例能使用与本机相同的模型 API 密钥（如 Anthropic），避免「No API key found for provider anthropic」；
- **不修改当前终端的环境变量**，仅子进程带有上述设置。

**退出 sync-cli（Ctrl+C 或关闭终端）时**：sync-cli 会终止该 OpenClaw 子进程，无需在父 shell 里做任何「恢复」；之后你照常启动 OpenClaw 即使用本地 `~/.openclaw` 人格。

**步骤小结（训练场要用平台人格时请严格按顺序）：**

1. 运行 `pnpm --filter @aifc/sync-cli run init`，在询问「Launch OpenClaw with platform persona when running sync?」时输入 **y**，并填写 OpenClaw 命令（默认 `openclaw`）及平台实例端口（默认 `18790`，用于与本地 18789 并存）。
2. **先启动网关**（如 `pnpm dev:backend`），再运行 `pnpm --filter @aifc/sync-cli run sync`。这样 sync-cli 能先从网关拉取平台人格并写入 `~/.aifuturecity`（SOUL.md 等），再启动 18790，训练场才会用平台人格。
3. **双实例时**：在 `.env.local` 中配置 `OPENCLAW_PLATFORM_URL=ws://localhost:18790`。sync-cli 启动 18790 后约 3 秒会打印「鉴权 token」，**把该 token 填入 `.env.local` 的 `OPENCLAW_PLATFORM_TOKEN`，然后重启网关**；否则网关会报 `gateway token mismatch`，训练场无法走 18790。
4. 使用完毕退出 sync-cli，则 OpenClaw（平台人格实例）一并退出；下次直接启动 OpenClaw 即为本地人格。

已初始化过的用户也可直接编辑 `~/.aifuturecity/sync-config.json`，增加 `"launchOpenClawWithSync": true` 和 `"openclawCommand": "openclaw"`（或你的启动命令），再执行 `run sync` 即可生效。

**若你先单独启动了 OpenClaw（本地人格），再运行 sync-cli？**  
sync-cli 只会再启动一个**新的** OpenClaw 子进程（使用平台人格），不会对你**之前已经启动**的 OpenClaw 做任何操作。退出 sync-cli 时仅会结束由 sync-cli 启动的那一个，你先启动的 OpenClaw 会继续运行，人格不受影响。

**双实例（本地 + 平台人格并存）**：若希望**不关本地 OpenClaw** 且训练场使用平台人格，可让 sync-cli 启动的 OpenClaw 使用**另一端口**（默认 **18790**）。init 时在「Platform OpenClaw port」填 `18790`（或自定义端口）。在**网关**的 `.env.local` 中增加：

- `OPENCLAW_PLATFORM_URL=ws://localhost:18790`
- `OPENCLAW_PLATFORM_TOKEN=<与平台实例鉴权一致，可与 OPENCLAW_LOCAL_TOKEN 相同>`

网关会将**训练场**请求（如 `training/chat/send`）发往平台实例，其余请求仍发往 `OPENCLAW_LOCAL_URL`（本地 18789）。这样本地 OpenClaw 与平台 OpenClaw 可同时运行，训练场自动用平台人格。

**平台实例鉴权**：18790 启动后，OpenClaw 会在 `~/.aifuturecity/openclaw.json` 中写入或覆盖 `gateway.auth.token`（可能为新生成的 token）。网关连接 18790 时必须使用**该文件中当前的 token**。操作方式二选一：
- **推荐**：运行 sync-cli 后，终端会打印一行「平台实例鉴权: … OPENCLAW_PLATFORM_TOKEN=\<token\>」，把该 token 填入**仓库根目录** `.env.local` 的 `OPENCLAW_PLATFORM_TOKEN`，并重启网关。
- 或手动查看 `cat ~/.aifuturecity/openclaw.json` 中 `gateway.auth.token` 的值，复制到 `.env.local` 的 `OPENCLAW_PLATFORM_TOKEN` 并重启网关。

若出现「gateway token mismatch」，说明网关使用的 token 与 `~/.aifuturecity/openclaw.json` 中 `gateway.auth.token` 不一致，按上一步用文件中的 token 更新 `.env.local` 即可。

---

### 方式 2：手动设置 OPENCLAW_STATE_DIR 后启动 OpenClaw

OpenClaw 支持通过环境变量 **`OPENCLAW_STATE_DIR`** 覆盖默认状态目录（[OpenClaw 文档](https://docs.openclaw.ai/help/environment)）。不采用方式 1 时，可手动在本次终端中设置后再启动 OpenClaw。

**步骤：**

1. 已用 sync-cli 将平台配置同步到 `~/.aifuturecity`（`run once` 或 `run sync`）。
2. **仅在此次接入平台时**，启动 OpenClaw 前设置环境变量（使用绝对路径更稳妥）：
   - macOS/Linux：`export OPENCLAW_STATE_DIR="$HOME/.aifuturecity"`
   - Windows（PowerShell）：`$env:OPENCLAW_STATE_DIR = "$env:USERPROFILE\.aifuturecity"`
3. 在**同一终端/进程**中启动 OpenClaw，再连接平台或使用训练场；该实例会读 `~/.aifuturecity` 下的 SOUL.md 等。
4. 关闭该终端或不再 export 时，下次启动 OpenClaw 仍使用 `~/.openclaw`，本地人格不受影响。

**示例（macOS/Linux，前台启动）：**

```bash
export OPENCLAW_STATE_DIR="$HOME/.aifuturecity"
openclaw
# 或：npx openclaw、pnpm openclaw 等
```

若通过 systemd / LaunchAgent 等常驻进程接入平台，在对应服务配置里为进程设置 `OPENCLAW_STATE_DIR=/home/你/.aifuturecity` 即可。

### 方式 3：OPENCLAW_HOME（整机隔离）

若希望该进程下**所有**与 OpenClaw 相关的路径（含 `~` 解析）都基于某目录，可设置 **`OPENCLAW_HOME`**（例如 `OPENCLAW_HOME=/path/to/aifuturecity`），则默认状态目录会变为 `$OPENCLAW_HOME/.openclaw`。若要把平台配置当「主目录」用，可把同步目录设为该目录下的 `.openclaw`，或仍优先用方式 1 只覆盖 `OPENCLAW_STATE_DIR`。

### 方式 4：插件注入人格（依赖 OpenClaw 能力）

若未来 OpenClaw 插件 API 在 `runAgent` 中支持传入额外 system prompt / context，可在 [aifuturecity 插件](client/extensions/aifuturecity) 的 task-handler 中注入服务端 persona 或已同步的 SOUL 内容。当前以方式 1 为准。

---

## 四、验证 18790 与平台人格

在 sync-cli 已配置「随 sync 启动 OpenClaw」且运行 `aifc-sync run` 后，可按以下步骤确认平台实例已就绪且训练场使用的是平台人格。

1. **确认 18790 在监听**
   ```bash
   lsof -i :18790
   ```
   应有进程监听该端口；若无，检查 sync-cli 是否选择了「Launch OpenClaw with platform persona when running sync」及端口配置（默认 18790）。

2. **确认同步目录已有核心文件**
   ```bash
   ls ~/.aifuturecity/SOUL.md ~/.aifuturecity/IDENTITY.md
   ```
   若缺失，先执行 `pnpm --filter @aifc/sync-cli run once` 或保持 `run sync` 完成一次同步。

3. **在训练场验证人格**
   - 在前端训练场发送一条可区分人格的消息（例如与 `~/.aifuturecity/SOUL.md` 中角色/职责相关的问题）。
   - 对比回复内容是否与平台配置一致（如角色描述、核心职责），而非本地 `~/.openclaw` 的人格。

4. **（可选）检查平台实例可用性**
   - 网关配置了 `OPENCLAW_PLATFORM_URL=ws://localhost:18790` 时，可调用 `GET /healthz`，确认响应中 `openClaw.platformConnected === true`。
   - 或使用 OpenClaw 客户端对 `ws://localhost:18790` 调用 `agents.list` / `health` 确认实例可响应。

**若仍出现 imessage / permissionDenied 等报错**：sync-cli 会在 `~/.aifuturecity/openclaw.json` 中写入 `channels.imessage.enabled: false` 与 `channels.feishu.enabled: false`，以减少平台实例的日志刷屏。若报错仍出现，可检查该文件中是否包含上述配置，或参考 OpenClaw 文档关闭不需要的通道。

---

## 五、与接入操作手册的关系

- **接入流程**（网关、OpenClaw、前端联调）见 [onboarding-manual.md](./onboarding-manual.md)；本地 OpenClaw 详细步骤见 [local-openclaw.md](./local-openclaw.md)。
- **训练场人格与平台一致**：在接入就绪后，按本文配置并运行 sync-cli，再按上文「人格生效方式」让 OpenClaw 在训练场场景使用 `~/.aifuturecity` 配置即可。验证 18790 与平台人格见上文 [四、验证 18790 与平台人格](#四验证-18790-与平台人格)。
