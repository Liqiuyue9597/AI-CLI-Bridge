import * as Lark from "@larksuiteoapi/node-sdk";
import { runClaudeStream, preCheck, type StreamTarget } from "./core.js";
import { sessionManager } from "./session.js";

// ── 飞书频道白名单 ──────────────────────────────────────────
const ALLOWED_LARK_CHATS = process.env.ALLOWED_LARK_CHATS
  ? new Set(process.env.ALLOWED_LARK_CHATS.split(",").map((s) => s.trim()))
  : null;

/**
 * 构建飞书卡片消息 JSON
 */
export function buildCard(text: string, isStreaming: boolean): string {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: isStreaming
      ? { title: { tag: "plain_text", content: "Claude 思考中..." }, template: "blue" }
      : { title: { tag: "plain_text", content: "Claude" }, template: "green" },
    elements: [
      {
        tag: "markdown",
        content: text || " ",
      },
    ],
  });
}

/**
 * 启动飞书 Bot
 */
export async function startLark() {
  const LARK_APP_ID = process.env.LARK_APP_ID;
  const LARK_APP_SECRET = process.env.LARK_APP_SECRET;

  if (!LARK_APP_ID || !LARK_APP_SECRET) {
    console.log("[飞书] 未配置 LARK_APP_ID / LARK_APP_SECRET，跳过飞书启动");
    return;
  }

  const client = new Lark.Client({
    appId: LARK_APP_ID,
    appSecret: LARK_APP_SECRET,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
  });

  const wsClient = new Lark.WSClient({
    appId: LARK_APP_ID,
    appSecret: LARK_APP_SECRET,
    loggerLevel: Lark.LoggerLevel.info,
  });

  // 消息去重：用 Map 记录时间戳，支持按时间过期清理
  const processedMessages = new Map<string, number>();
  const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 分钟过期

  /** 定期清理过期的去重记录 */
  setInterval(() => {
    const now = Date.now();
    for (const [id, timestamp] of processedMessages) {
      if (now - timestamp > DEDUP_TTL_MS) {
        processedMessages.delete(id);
      }
    }
  }, 60_000);

  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: Record<string, any>) => {
        try {
          const message = data.message;
          const messageId = message.message_id;

          // 去重
          if (processedMessages.has(messageId)) return;
          processedMessages.set(messageId, Date.now());

          // 只处理文本消息
          if (message.message_type !== "text") return;

          const chatId = message.chat_id;

          // 频道白名单
          if (ALLOWED_LARK_CHATS && !ALLOWED_LARK_CHATS.has(chatId)) return;

          const senderId = data.sender?.sender_id?.open_id || "unknown";
          const senderName = data.sender?.sender_id?.open_id || "飞书用户";

          // 解析消息内容
          let content: string;
          try {
            const parsed = JSON.parse(message.content);
            content = parsed.text || "";
          } catch {
            content = message.content || "";
          }

          // 去掉 @机器人 部分
          const prompt = content.replace(/@_user_\d+/g, "").trim();
          if (!prompt) return;

          console.log(`[飞书] [${senderId}] ${senderName}: ${prompt.slice(0, 50)}...`);

          // 内置命令：whoami — 返回用户 ID，方便配置白名单
          if (prompt.toLowerCase() === "whoami") {
            try {
              await client.im.message.reply({
                path: { message_id: messageId },
                data: {
                  content: JSON.stringify({
                    text: `你的飞书 Open ID: ${senderId}\n群聊 Chat ID: ${chatId}\n\n将 Open ID 添加到 .env 的 ALLOWED_USERS 即可获得使用权限。`,
                  }),
                  msg_type: "text",
                },
              });
            } catch (err) {
              console.warn("[飞书] 发送 whoami 回复失败:", (err as Error).message);
            }
            return;
          }

          // 内置命令：reset / new — 重置会话，开始新对话
          if (prompt.toLowerCase() === "reset" || prompt.toLowerCase() === "new") {
            const had = sessionManager.resetSession(senderId);
            try {
              await client.im.message.reply({
                path: { message_id: messageId },
                data: {
                  content: JSON.stringify({
                    text: had
                      ? "会话已重置，下次提问将开始新的对话。"
                      : "当前没有活跃的会话。",
                  }),
                  msg_type: "text",
                },
              });
            } catch (err) {
              console.warn("[飞书] 发送 reset 回复失败:", (err as Error).message);
            }
            console.log(`[飞书] [reset] ${senderId} (had session: ${had})`);
            return;
          }

          // 前置检查（鉴权、速率限制、并发控制）
          const check = preCheck(senderId);
          if (!check.ok) {
            try {
              await client.im.message.reply({
                path: { message_id: messageId },
                data: {
                  content: JSON.stringify({ text: check.message }),
                  msg_type: "text",
                },
              });
            } catch (err) {
              console.warn("[飞书] 发送拒绝消息失败:", (err as Error).message);
            }
            return;
          }

          const existingSession = sessionManager.getSession(senderId);

          // 用卡片消息实现流式更新
          let replyMessageId: string | null = null;
          let lastText = "";

          const target: StreamTarget = {
            update: async (text) => {
              lastText = text;
              try {
                if (!replyMessageId) {
                  const res = await client.im.message.reply({
                    path: { message_id: messageId },
                    data: {
                      content: buildCard(text, true),
                      msg_type: "interactive",
                    },
                  });
                  replyMessageId = res.data?.message_id || null;
                } else {
                  await client.im.message.patch({
                    path: { message_id: replyMessageId },
                    data: {
                      content: buildCard(text, true),
                    },
                  });
                }
              } catch (err: unknown) {
                const larkErr = err as { response?: { data?: { code?: number; msg?: string } } };
                const code = larkErr?.response?.data?.code;
                if (code && code !== 230001) {
                  console.warn("[飞书] 更新消息失败:", code, larkErr?.response?.data?.msg);
                }
              }
            },
            followUp: async (text) => {
              try {
                await client.im.message.create({
                  params: { receive_id_type: "chat_id" },
                  data: {
                    receive_id: chatId,
                    content: JSON.stringify({ text }),
                    msg_type: "text",
                  },
                });
              } catch (err) {
                console.warn("[飞书] 发送后续消息失败:", (err as Error).message);
              }
            },
          };

          await runClaudeStream(
            senderId,
            senderName,
            prompt,
            existingSession || undefined,
            target
          );

          // 完成后把卡片标题改为绿色"Claude"（表示已完成）
          if (replyMessageId) {
            try {
              await client.im.message.patch({
                path: { message_id: replyMessageId },
                data: {
                  content: buildCard(lastText, false),
                },
              });
            } catch (err) {
              console.warn("[飞书] 更新完成状态失败:", (err as Error).message);
            }
          }
        } catch (err) {
          console.error("[飞书] 处理消息异常:", err);
        }
      },
    }),
  });

  console.log("飞书 Bot 已启动（长连接模式）");
}
