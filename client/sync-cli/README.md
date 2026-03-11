# @aifc/sync-cli

AIFutureCity **config sync CLI**: syncs gateway assistant config (persona, tools, constraints) to a local parallel config directory (`~/.aifuturecity` by default) so that the AI assistant used in the **training ground** reflects the platform configuration without overwriting your existing OpenClaw config (`~/.openclaw`).

## Commands

| Command | Description |
|--------|-------------|
| `aifc-sync init` | Interactive setup: gateway URL, assistant ID, source path (~/.openclaw), parallel path (~/.aifuturecity) |
| `aifc-sync once` | Fetch config from gateway and write SOUL.md, IDENTITY.md, etc. to the parallel path once |
| `aifc-sync run` | Keep WebSocket heartbeat to gateway and poll config; update parallel path when config changes (default) |

## Options

- `-c, --config <path>` — Parallel config path (default: `~/.aifuturecity`) where `sync-config.json` is read from.
- `-h, --help` — Show help.

## Quick start

From the repo root:

```bash
# Build
pnpm --filter @aifc/sync-cli build

# One-time setup (interactive)
node client/sync-cli/dist/cli.js init

# Fetch config once and write to ~/.aifuturecity
node client/sync-cli/dist/cli.js once

# Run with heartbeat + polling (foreground)
node client/sync-cli/dist/cli.js run
```

Or from repo root, use the package scripts (no global install needed):

```bash
pnpm --filter @aifc/sync-cli run init
pnpm --filter @aifc/sync-cli run once
pnpm --filter @aifc/sync-cli run sync
```

## Files written

Under the parallel path (e.g. `~/.aifuturecity`):

| File | Content source |
|------|-----------------|
| `SOUL.md` | Server `persona` (role, description, coreResponsibilities, skillTags) |
| `IDENTITY.md` | Server `name`, persona.role |
| `USER.md` | Placeholder / platform extension |
| `AGENTS.md` | Placeholder / work style |
| `TOOLS.md` | Server `tools` and `constraints` |
| `sync-config.json` | Gateway URL, assistant ID, paths (written by `init`) |

## Making the synced config take effect

For the training ground to use the **platform** persona, start OpenClaw with the state directory pointing at the synced folder:

- **OPENCLAW_STATE_DIR** — Set OPENCLAW_STATE_DIR so OpenClaw uses the synced folder. Example: macOS/Linux `export OPENCLAW_STATE_DIR="$HOME/.aifuturecity"`; Windows PowerShell `$env:OPENCLAW_STATE_DIR = "$env:USERPROFILE\.aifuturecity"`. Then start OpenClaw in the same shell. Your normal `~/.openclaw` is unchanged when you run OpenClaw without this variable.
- **Plugin injection (future)** — If the OpenClaw plugin API allows passing extra system prompt/context into `runAgent`, the platform could inject the server persona or the synced SOUL content for training sessions.

See [docs/sync-cli-training-persona.md](../../docs/sync-cli-training-persona.md) for full steps and OpenClaw env docs.
