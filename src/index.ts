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
import { ALL_COMMANDS } from "./commands.js";
import { runClaudeStream, type StreamTarget } from "./core.js";
import { sessionManager } from "./session.js";
import { startLark } from "./lark.js";

dotenv.config();

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
  await interaction.deferReply();

  const target: StreamTarget = {
    update: async (content) => {
      try { await interaction.editReply(content); } catch {}
    },
    followUp: async (content) => {
      try { await interaction.followUp(content); } catch {}
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
      } catch {}
    },
    followUp: async (content) => {
      try {
        if ("send" in message.channel) {
          await message.channel.send(content);
        }
      } catch {}
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

// ── 主入口 ───────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Claude Bridge - 多平台桥接服务");
  console.log("═══════════════════════════════════════════");

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
