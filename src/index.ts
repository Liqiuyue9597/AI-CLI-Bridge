import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Message,
  type ChatInputCommandInteraction,
  type Interaction,
  Partials,
} from "discord.js";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { ALL_COMMANDS } from "./commands.js";
import { runClaudeStream, preCheck, type StreamTarget } from "./core.js";
import { sessionManager } from "./session.js";
import { startLark } from "./lark.js";
import { killAllChildren } from "./adapters.js";

// 固定读取项目根目录的 .env，避免因启动目录不同而读到其他项目的配置
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

// ── Discord 配置 ─────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_APP_ID = process.env.DISCORD_APP_ID;

const ALLOWED_CHANNELS = process.env.ALLOWED_CHANNELS
  ? process.env.ALLOWED_CHANNELS.split(",").map((s) => s.trim())
  : null;

// ── 注册斜杠命令 ─────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN!);
  try {
    console.log("正在注册斜杠命令...");
    await rest.put(Routes.applicationCommands(DISCORD_APP_ID!), {
      body: ALL_COMMANDS,
    });
    console.log("斜杠命令注册成功！");
  } catch (error) {
    console.error("注册命令失败:", error);
  }
}

// ── 斜杠命令流式输出 ────────────────────────────────────────
async function handleClaudeStream(
  interaction: ChatInputCommandInteraction,
  prompt: string,
  sessionId: string | undefined
) {
  // 前置检查（鉴权、速率限制、并发控制）
  const check = preCheck(interaction.user.id);
  if (!check.ok) {
    await interaction.reply({ content: check.message!, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const target: StreamTarget = {
    update: async (content) => {
      try {
        await interaction.editReply(content);
      } catch (err) {
        console.warn("[Discord] editReply 失败:", (err as Error).message);
      }
    },
    followUp: async (content) => {
      try {
        await interaction.followUp(content);
      } catch (err) {
        console.warn("[Discord] followUp 失败:", (err as Error).message);
      }
    },
  };

  await runClaudeStream(
    interaction.user.id,
    interaction.user.tag,
    prompt,
    sessionId,
    target
  );
}

// ── @机器人 消息处理 ─────────────────────────────────────────
async function handleMention(message: Message) {
  if (message.author.bot) return;
  if (ALLOWED_CHANNELS && !ALLOWED_CHANNELS.includes(message.channelId)) return;

  const prompt = message.content
    .replace(/<@!?\d+>/g, "")
    .trim();

  if (!prompt) {
    await message.reply("你想问什么？直接 @我 加上你的问题就行！");
    return;
  }

  const userId = message.author.id;

  // 内置命令：whoami — 返回用户 ID，方便配置白名单
  if (prompt.toLowerCase() === "whoami") {
    await message.reply(
      `你的 Discord 用户 ID: \`${userId}\`\n频道 ID: \`${message.channelId}\`\n\n将用户 ID 添加到 \`.env\` 的 \`ALLOWED_USERS\` 即可获得使用权限。`
    );
    return;
  }

  // 前置检查（鉴权、速率限制、并发控制）
  const check = preCheck(userId);
  if (!check.ok) {
    await message.reply(check.message!);
    return;
  }

  const existingSession = sessionManager.getSession(userId);

  console.log(
    `[@提及] ${message.author.tag}: ${prompt.slice(0, 50)}... (session: ${existingSession ? "resume" : "new"})`
  );

  let replyMsg: Message | null = null;

  const target: StreamTarget = {
    update: async (content) => {
      try {
        if (!replyMsg) {
          replyMsg = await message.reply(content);
        } else {
          await replyMsg.edit(content);
        }
      } catch (err) {
        console.warn("[Discord] 消息更新失败:", (err as Error).message);
      }
    },
    followUp: async (content) => {
      try {
        if ("send" in message.channel) {
          await message.channel.send(content);
        }
      } catch (err) {
        console.warn("[Discord] followUp 消息发送失败:", (err as Error).message);
      }
    },
  };

  await runClaudeStream(
    userId,
    message.author.tag,
    prompt,
    existingSession || undefined,
    target
  );
}

// ── 处理斜杠命令交互 ────────────────────────────────────────
async function handleInteraction(interaction: Interaction) {
  if (!interaction.isChatInputCommand()) return;

  if (ALLOWED_CHANNELS && !ALLOWED_CHANNELS.includes(interaction.channelId)) {
    await interaction.reply({
      content: "此频道未启用 Claude 桥接服务。",
      ephemeral: true,
    });
    return;
  }

  const { commandName, user } = interaction;

  switch (commandName) {
    case "ask": {
      const prompt = interaction.options.getString("prompt", true);
      console.log(`[/ask] ${user.tag}: ${prompt.slice(0, 50)}...`);
      await handleClaudeStream(interaction, prompt, undefined);
      break;
    }

    case "chat": {
      const prompt = interaction.options.getString("prompt", true);
      const existingSession = sessionManager.getSession(user.id);
      console.log(
        `[/chat] ${user.tag}: ${prompt.slice(0, 50)}... (session: ${existingSession ? "resume" : "new"})`
      );
      await handleClaudeStream(interaction, prompt, existingSession || undefined);
      break;
    }

    case "reset": {
      const had = sessionManager.resetSession(user.id);
      await interaction.reply({
        content: had
          ? "已重置对话！下次 @我 或使用 `/ask` 将开始全新对话。"
          : "当前没有活跃的对话。",
        ephemeral: true,
      });
      console.log(`[/reset] ${user.tag} (had session: ${had})`);
      break;
    }

    case "status": {
      const info = sessionManager.getSessionInfo(user.id);
      if (info) {
        const age = Math.round((Date.now() - info.createdAt) / 1000 / 60);
        await interaction.reply({
          content: [
            "**当前会话状态**",
            `- Session ID: \`${info.sessionId.slice(0, 8)}...\``,
            `- 消息数: ${info.messageCount}`,
            `- 创建于: ${age} 分钟前`,
            `- 处理中: ${sessionManager.isProcessing(user.id) ? "是" : "否"}`,
          ].join("\n"),
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "当前没有活跃的对话。@我 或使用 `/ask` 开始新对话。",
          ephemeral: true,
        });
      }
      break;
    }
  }
}

// ── Discord Client 引用（用于 shutdown）─────────────────────
let discordClient: Client | null = null;

// ── 启动 Discord Bot ─────────────────────────────────────────
async function startDiscord() {
  if (!DISCORD_TOKEN || !DISCORD_APP_ID) {
    console.log("[Discord] 未配置 DISCORD_TOKEN / DISCORD_APP_ID，跳过 Discord 启动");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Channel],
  });

  discordClient = client;

  client.once("ready", (c) => {
    console.log(`[Discord] Bot 已上线: ${c.user.tag}`);
    console.log(`[Discord] 已加入 ${c.guilds.cache.size} 个服务器`);
  });

  client.on("interactionCreate", handleInteraction);

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    // 私聊：直接处理所有消息，无需 @
    if (!message.guild) {
      await handleMention(message);
      return;
    }
    // 群聊：需要 @机器人
    if (client.user && message.mentions.has(client.user)) {
      await handleMention(message);
    }
  });

  await registerCommands();
  await client.login(DISCORD_TOKEN);
}

// ── Graceful Shutdown ────────────────────────────────────────
function setupGracefulShutdown() {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n收到 ${signal}，正在优雅退出...`);

    // 终止所有 CLI 子进程
    killAllChildren();

    // 断开 Discord 连接
    if (discordClient) {
      try {
        discordClient.destroy();
        console.log("[Discord] 已断开连接");
      } catch (err) {
        console.warn("[Discord] 断开连接失败:", (err as Error).message);
      }
    }

    console.log("已退出。");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ── 主入口 ───────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  AI CLI Bridge - 多平台桥接服务");
  console.log("═══════════════════════════════════════════");

  // 安全提醒
  if (process.env.SKIP_PERMISSIONS === "true") {
    console.warn("⚠️  警告: SKIP_PERMISSIONS=true，Claude 将跳过权限检查。请确保已配置 ALLOWED_USERS！");
  }
  if (!process.env.ALLOWED_USERS) {
    console.warn("⚠️  警告: 未配置 ALLOWED_USERS，所有用户都可以使用此 Bot。建议设置用户白名单。");
  }

  // 设置优雅退出
  setupGracefulShutdown();

  // 定期清理过期会话
  setInterval(() => {
    const cleaned = sessionManager.cleanup();
    if (cleaned > 0) {
      console.log(`清理了 ${cleaned} 个过期会话`);
    }
  }, 30 * 60 * 1000);

  // 同时启动所有已配置的平台
  const platforms = [startDiscord(), startLark()];
  await Promise.all(platforms);
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
