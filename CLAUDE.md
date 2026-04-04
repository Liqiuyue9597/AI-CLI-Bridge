# AI CLI Bridge

Bridge AI CLI tools (Claude Code, Codex, Gemini) to chat platforms (Discord, Feishu/Lark).

## Architecture

```
Chat Platform (Discord / Feishu)
  → src/index.ts (Discord) / src/lark.ts (Feishu)   # Platform adapters
    → src/core.ts: preCheck() + runClaudeStream()    # Auth, rate limit, streaming orchestration
      → src/adapters.ts: streamCLI()                 # Spawn CLI subprocess, parse output
      → src/session.ts: SessionManager               # Session, concurrency, rate limiting
```

## Key Files

- `src/index.ts` — Entry point, Discord bot handlers, graceful shutdown
- `src/core.ts` — Platform-agnostic streaming core, `preCheck()` (auth + rate limit + concurrency), `splitMessage()`
- `src/adapters.ts` — CLI adapter pattern (Claude/Codex/Gemini/plain-text), `streamCLI()` async generator
- `src/session.ts` — `SessionManager` class: user whitelist, per-user concurrency lock, sliding-window rate limiter, session CRUD with TTL
- `src/lark.ts` — Feishu bot: WebSocket long connection, card message streaming, dedup
- `src/commands.ts` — Discord slash command definitions
- `src/setup.ts` — Interactive setup wizard (`npm run setup`)

## Commands

```bash
npm start          # Start the bot
npm run dev        # Dev mode with hot reload
npm test           # Run unit tests (vitest, 67 cases)
npm run test:watch # Watch mode
npm run setup      # Interactive config wizard
```

## Tech Stack

- TypeScript (strict, ESM, ES2022)
- discord.js — Discord bot
- @larksuiteoapi/node-sdk — Feishu bot (WebSocket mode)
- vitest — Testing
- dotenv — Config from .env

## Config

All config via `.env` (see `.env.example`). Key variables:
- `DISCORD_TOKEN` / `DISCORD_APP_ID` — Discord credentials
- `LARK_APP_ID` / `LARK_APP_SECRET` — Feishu credentials
- `ALLOWED_USERS` — User whitelist (comma-separated IDs). **Critical for security**
- `SKIP_PERMISSIONS` — Set `true` to skip Claude permission checks (dangerous)
- `CLI_PATH` — CLI executable (default: `claude`)
- `CLAUDE_WORK_DIR` — Working directory for CLI
- `CLI_TIMEOUT_MS` — Subprocess timeout (default: 300000ms)
- `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` — Rate limiting

## Testing

Tests are in `tests/`. Each test file maps to a source module:
- `tests/session.test.ts` — SessionManager (auth, concurrency, rate limit, session CRUD, cleanup)
- `tests/core.test.ts` — splitMessage, preCheck
- `tests/adapters.test.ts` — getAdapter, formatToolUse, claudeAdapter.parseLine
- `tests/lark.test.ts` — buildCard

Use `new SessionManager()` in tests (not the singleton) to avoid state leakage. Use `vi.useFakeTimers()` for TTL/rate-limit tests.

## Security Model

All incoming messages go through `preCheck()` in `core.ts`:
1. `isUserAllowed()` — ALLOWED_USERS whitelist (Set lookup)
2. `checkRateLimit()` — Sliding window per user
3. `tryAcquire()` — Per-user concurrency lock (one request at a time)

The `whoami` command (in both Discord and Feishu) bypasses preCheck so users can discover their ID for whitelist config.

`--dangerously-skip-permissions` is NOT passed by default; requires `SKIP_PERMISSIONS=true`.
