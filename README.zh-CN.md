# AI CLI Bridge

[English](./README.md)

通过 Discord / 飞书等聊天平台远程操控 AI **CLI** 工具（Claude Code、Codex、Gemini 等），让你用手机就能指挥 AI 帮你写代码。

## 特性

- **多平台支持** — Discord + 飞书，可同时在线
- **多 CLI 适配** — 支持 Claude Code / Codex / Gemini 等，可扩展
- **流式输出** — 实时显示 AI 思考和执行过程
- **多轮对话** — 自动保持上下文，连续对话无需重复说明
- **工具可见** — 实时显示 AI 正在执行的命令（读文件、跑脚本等）
- **私聊 + 群聊** — 私聊直接对话，群聊 @机器人 触发
- **交互式配置** — `npm run setup` 一键引导配置

## 架构

```
手机 / 电脑
  │
  ├── Discord  ──┐
  │              ├──> Claude Bridge (本地/云端) ──> AI CLI ──> 操作文件系统
  └── 飞书    ──┘
```

## 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/your-username/AI-CLI-Bridge.git
cd AI-CLI-Bridge

# 2. 安装依赖
npm install

# 3. 交互式配置（选择平台、CLI 工具、工作目录）
npm run setup

# 4. 启动
npm start
```

## 配置说明

运行 `npm run setup` 会引导你完成以下配置：

### 平台配置

| 平台 | 需要什么 | 获取地址 |
|------|---------|---------|
| Discord | Bot Token + App ID | [Discord Developer Portal](https://discord.com/developers/applications) |
| 飞书 | App ID + App Secret | [飞书开放平台](https://open.feishu.cn/app) |

### 飞书额外配置

1. 在应用中添加 **机器人** 能力
2. 开通权限：`im:message`
3. 事件订阅：`im.message.receive_v1`，选择 **长连接模式**
4. 发布应用并通过审批

### Discord 额外配置

1. 在 Bot 页面开启 **Message Content Intent**
2. 邀请链接（替换 APP_ID）：
   ```
   https://discord.com/oauth2/authorize?client_id=你的APP_ID&scope=bot+applications.commands&permissions=397284550656
   ```

### 支持的 CLI 工具

| CLI | 流式输出 | 多轮对话 | 工具调用可见 |
|-----|---------|---------|------------|
| `claude` / `claude-internal` | ✅ 结构化 | ✅ | ✅ |
| `codex` | ✅ 文本流 | ❌ | ❌ |
| `gemini` | ✅ 文本流 | ❌ | ❌ |
| 自定义 CLI | ✅ 文本流 | ❌ | ❌ |

## 使用方式

### Discord

| 方式 | 说明 |
|------|------|
| `@机器人 你好` | 群聊中 @机器人对话 |
| 直接发消息 | 私聊中直接对话 |
| `/ask <问题>` | 开始新对话 |
| `/chat <内容>` | 继续当前对话 |
| `/reset` | 重置对话记忆 |
| `/status` | 查看会话状态 |

### 飞书

| 方式 | 说明 |
|------|------|
| `@机器人 你好` | 群聊中 @机器人对话 |
| 直接发消息 | 私聊中直接对话 |

## 后台运行

```bash
# 使用 pm2 保活
npm install -g pm2
pm2 start "npx tsx src/index.ts" --name ai-cli-bridge
pm2 save
pm2 startup  # 设置开机自启
```

## 项目结构

```
AI-CLI-Bridge/
├── src/
│   ├── index.ts      # 入口 - 多平台启动
│   ├── core.ts       # 核心 - 流式处理、消息分割
│   ├── claude.ts     # CLI 适配器 - 支持多种 AI CLI
│   ├── session.ts    # 会话管理
│   ├── commands.ts   # Discord 斜杠命令定义
│   ├── lark.ts       # 飞书适配层
│   └── setup.ts      # 交互式配置向导
├── .env.example      # 配置模板
├── package.json
└── tsconfig.json
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DISCORD_TOKEN` | 可选 | Discord Bot Token |
| `DISCORD_APP_ID` | 可选 | Discord Application ID |
| `LARK_APP_ID` | 可选 | 飞书 App ID |
| `LARK_APP_SECRET` | 可选 | 飞书 App Secret |
| `CLI_PATH` | 可选 | AI CLI 路径，默认 `claude-internal` |
| `CLAUDE_WORK_DIR` | 可选 | 工作目录，默认 `$HOME` |
| `ALLOWED_CHANNELS` | 可选 | Discord 频道白名单（逗号分隔） |

## License

MIT
