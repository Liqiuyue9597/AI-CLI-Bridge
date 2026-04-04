import * as Lark from "@larksuiteoapi/node-sdk";
import { runClaudeStream, type StreamTarget } from "./core.js";
import { sessionManager } from "./session.js";

/**
 * 构建飞书卡片消息 JSON
 */
function buildCard(text: string, isStreaming: boolean): string {
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

  // 消息去重
  const processedMessages = new Set<string>();

  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        try {
          const message = data.message;
          const messageId = message.message_id;

          // 去重
          if (processedMessages.has(messageId)) return;
          processedMessages.add(messageId);
          if (processedMessages.size > 1000) {
            const arr = [...processedMessages];
            arr.splice(0, 500).forEach((id) => processedMessages.delete(id));
          }

          // 只处理文本消息
          if (message.message_type !== "text") return;

          const chatId = message.chat_id;
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

          console.log(`[飞书] ${senderName}: ${prompt.slice(0, 50)}...`);

          const existingSession = sessionManager.getSession(senderId);

          // 用卡片消息实现流式更新
          let replyMessageId: string | null = null;
          let lastText = "";

          const target: StreamTarget = {
            update: async (text) => {
              lastText = text;
              try {
                if (!replyMessageId) {
                  // 首次：发送卡片消息（reply 到原消息）
                  const res = await client.im.message.reply({
                    path: { message_id: messageId },
                    data: {
                      content: buildCard(text, true),
                      msg_type: "interactive",
                    },
                  });
                  replyMessageId = res.data?.message_id || null;
                } else {
                  // 后续：patch 更新卡片内容
                  await client.im.message.patch({
                    path: { message_id: replyMessageId },
                    data: {
                      content: buildCard(text, true),
                    },
                  });
                }
              } catch (err: any) {
                // 忽略频率限制等非致命错误
                const code = err?.response?.data?.code;
                if (code && code !== 230001) {
                  console.error("[飞书] 更新消息失败:", code, err?.response?.data?.msg);
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
                console.error("[飞书] 发送后续消息失败:", err);
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
            } catch {}
          }
        } catch (err) {
          console.error("[飞书] 处理消息异常:", err);
        }
      },
    }),
  });

  console.log("飞书 Bot 已启动（长连接模式）");
}
