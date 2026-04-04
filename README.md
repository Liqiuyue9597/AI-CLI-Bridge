# AI CLI Bridge

[中文文档](./README.zh-CN.md)

Control AI CLI tools (Claude Code, Codex, Gemini, etc.) remotely through chat platforms like Discord and Feishu/Lark. Code from your phone.

## Features

- **Multi-Platform** — Discord + Feishu/Lark, run simultaneously
- **Multi-CLI** — Supports Claude Code / Codex / Gemini and more, extensible
- **Streaming Output** — Real-time display of AI thinking and execution progress
- **Multi-Turn Chat** — Automatic context retention across conversations
- **Tool Visibility** — See what AI is doing in real-time (reading files, running scripts, etc.)
- **DM + Group Chat** — Direct message or @mention in group chats
- **Interactive Setup** — `npm run setup` guides you through configuration

## Architecture

```
Phone / Desktop
  │
  ├── Discord  ──┐
  │              ├──> AI CLI Bridge (local/cloud) ──> AI CLI ──> File System
  └── Feishu   ──┘
```

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/your-username/AI-CLI-Bridge.git
cd AI-CLI-Bridge

# 2. Install dependencies
npm install

# 3. Interactive setup (choose platform, CLI tool, work directory)
npm run setup

# 4. Start
npm start
```

## Configuration

Run `npm run setup` to configure interactively, or manually create a `.env` file from `.env.example`.

### Platform Setup

| Platform | Required | Where to Get |
|----------|----------|-------------|
| Discord | Bot Token + App ID | [Discord Developer Portal](https://discord.com/developers/applications) |
| Feishu/Lark | App ID + App Secret | [Feishu Open Platform](https://open.feishu.cn/app) |

### Feishu/Lark Additional Setup

1. Add **Bot** capability to your app
2. Enable permission: `im:message`
3. Subscribe to event: `im.message.receive_v1`, select **Long Connection** mode
4. Publish the app and get approval

### Discord Additional Setup

1. Enable **Message Content Intent** on the Bot page
2. Invite link (replace APP_ID):
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=397284550656
   ```

### Supported CLI Tools

| CLI | Streaming | Multi-Turn | Tool Visibility |
|-----|-----------|-----------|-----------------|
| `claude` | ✅ Structured | ✅ | ✅ |
| `codex` | ✅ Text stream | ❌ | ❌ |
| `gemini` | ✅ Text stream | ❌ | ❌ |
| Custom CLI | ✅ Text stream | ❌ | ❌ |

## Usage

### Discord

| Method | Description |
|--------|-------------|
| `@bot hello` | Mention the bot in a group chat |
| Direct message | Chat in DMs without @mention |
| `/ask <prompt>` | Start a new conversation |
| `/chat <prompt>` | Continue current conversation |
| `/reset` | Reset conversation memory |
| `/status` | View session status |

### Feishu/Lark

| Method | Description |
|--------|-------------|
| `@bot hello` | Mention the bot in a group chat |
| Direct message | Chat in DMs without @mention |

## Running in Background

```bash
# Using pm2 for process management
npm install -g pm2
pm2 start "npx tsx src/index.ts" --name ai-cli-bridge
pm2 save
pm2 startup  # Auto-start on boot
```

## Project Structure

```
AI-CLI-Bridge/
├── src/
│   ├── index.ts      # Entry - multi-platform launcher
│   ├── core.ts       # Core - streaming handler, message splitting
│   ├── claude.ts     # CLI adapters - supports multiple AI CLIs
│   ├── session.ts    # Session management
│   ├── commands.ts   # Discord slash commands
│   ├── lark.ts       # Feishu/Lark adapter
│   └── setup.ts      # Interactive setup wizard
├── .env.example      # Config template
├── package.json
└── tsconfig.json
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Optional | Discord Bot Token |
| `DISCORD_APP_ID` | Optional | Discord Application ID |
| `LARK_APP_ID` | Optional | Feishu/Lark App ID |
| `LARK_APP_SECRET` | Optional | Feishu/Lark App Secret |
| `CLI_PATH` | Optional | AI CLI path, defaults to `claude` |
| `CLAUDE_WORK_DIR` | Optional | Working directory, defaults to `$HOME` |
| `ALLOWED_CHANNELS` | Optional | Discord channel whitelist (comma-separated) |

## License

MIT
