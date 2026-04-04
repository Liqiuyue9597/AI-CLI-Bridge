import { streamClaude } from "./claude.js";
import { sessionManager } from "./session.js";

// ── 常量 ─────────────────────────────────────────────────────
export const MAX_MESSAGE_LENGTH = 1900;
export const STREAM_UPDATE_INTERVAL_MS = 1500;

// ── 通用流式处理接口 ─────────────────────────────────────────
export interface StreamTarget {
  /** 发送/更新第一条消息 */
  update: (content: string) => Promise<void>;
  /** 发送后续分割消息 */
  followUp: (content: string) => Promise<void>;
}

/**
 * 平台无关的 Claude 流式处理核心
 */
export async function runClaudeStream(
  userId: string,
  userName: string,
  prompt: string,
  sessionId: string | undefined,
  target: StreamTarget
) {
  let accumulated = "";
  let toolStatus = "";
  let lastUpdateTime = 0;
  let resultSessionId = sessionId;

  const getDisplayText = () => {
    let display = accumulated;
    if (toolStatus) {
      display += (display ? "\n\n" : "") + toolStatus;
    }
    return display;
  };

  try {
    for await (const event of streamClaude(prompt, { sessionId })) {
      if (event.type === "text") {
        toolStatus = "";
        accumulated += event.content;
        if (event.sessionId) {
          resultSessionId = event.sessionId;
        }

        const now = Date.now();
        if (now - lastUpdateTime >= STREAM_UPDATE_INTERVAL_MS) {
          lastUpdateTime = now;
          await target.update(getDisplayText() + " ▌");
        }
      } else if (event.type === "tool") {
        toolStatus = event.content + "⏳ _执行中..._";
        if (event.sessionId) {
          resultSessionId = event.sessionId;
        }
        await target.update(getDisplayText());
        lastUpdateTime = Date.now();
      } else if (event.type === "done") {
        if (accumulated === "" && event.content) {
          accumulated = event.content;
        }
        if (event.sessionId) {
          resultSessionId = event.sessionId;
        }
      } else if (event.type === "error") {
        accumulated += `\n\n> **Error:** ${event.content}`;
      }
    }
  } catch (err) {
    accumulated += `\n\n> **Error:** ${err instanceof Error ? err.message : String(err)}`;
  }

  if (resultSessionId) {
    sessionManager.setSession(userId, resultSessionId);
  }

  if (accumulated === "") {
    accumulated = "_（Claude 没有返回内容）_";
  }

  const chunks = splitMessage(accumulated);
  await target.update(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await target.followUp(chunks[i]);
  }

  console.log(`[回复完成] ${userName}: ${accumulated.slice(0, 50)}...`);
}

/**
 * 按消息长度限制分割文本
 */
export function splitMessage(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex <= 0) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }

  return chunks;
}
