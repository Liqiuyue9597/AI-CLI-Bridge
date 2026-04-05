import { streamClaude } from "./adapters.js";
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

/** 前置检查结果 */
export interface PreCheckResult {
  ok: boolean;
  /** 如果 ok === false，返回给用户的提示消息 */
  message?: string;
}

/**
 * 在执行 CLI 调用前进行鉴权、速率限制和并发检查
 */
export function preCheck(userId: string): PreCheckResult {
  // 用户白名单鉴权
  if (!sessionManager.isUserAllowed(userId)) {
    return { ok: false, message: "你没有权限使用此 Bot。请联系管理员将你的用户 ID 添加到 ALLOWED_USERS。" };
  }

  // 速率限制
  const waitSeconds = sessionManager.checkRateLimit(userId);
  if (waitSeconds !== null) {
    return { ok: false, message: `请求过于频繁，请 ${waitSeconds} 秒后再试。` };
  }

  // 并发控制
  if (!sessionManager.tryAcquire(userId)) {
    return { ok: false, message: "你的上一个请求还在处理中，请等它完成后再试。" };
  }

  return { ok: true };
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
          const full = getDisplayText() + " ▌";
          const display =
            full.length > MAX_MESSAGE_LENGTH
              ? "...\n\n" + full.slice(full.length - MAX_MESSAGE_LENGTH + 5)
              : full;
          await target.update(display);
        }
      } else if (event.type === "tool") {
        toolStatus = event.content + "⏳ _执行中..._";
        if (event.sessionId) {
          resultSessionId = event.sessionId;
        }
        const toolDisplay = getDisplayText();
        const truncatedToolDisplay =
          toolDisplay.length > MAX_MESSAGE_LENGTH
            ? "...\n\n" + toolDisplay.slice(toolDisplay.length - MAX_MESSAGE_LENGTH + 5)
            : toolDisplay;
        await target.update(truncatedToolDisplay);
        lastUpdateTime = Date.now();
      } else if ((event as any).type === "replace") {
        // 文本被整体替换（Claude 工具调用后重写了 text block）
        const replaceEvent = event as any;
        const prevLen = replaceEvent.prevLength || 0;
        toolStatus = "";

        // 从 accumulated 中移除旧文本，替换为新文本
        if (prevLen > 0 && accumulated.length >= prevLen) {
          accumulated = accumulated.slice(0, accumulated.length - prevLen) + replaceEvent.content;
        } else {
          accumulated = replaceEvent.content;
        }

        if (replaceEvent.sessionId) {
          resultSessionId = replaceEvent.sessionId;
        }

        // 替换后立即推送一次更新
        const now = Date.now();
        lastUpdateTime = now;
        const full = getDisplayText() + " ▌";
        const display =
          full.length > MAX_MESSAGE_LENGTH
            ? "...\n\n" + full.slice(full.length - MAX_MESSAGE_LENGTH + 5)
            : full;
        await target.update(display);
      } else if (event.type === "done") {
        if (accumulated === "" && event.content) {
          accumulated = event.content;
        }
        if (event.sessionId) {
          resultSessionId = event.sessionId;
        }
      } else if (event.type === "error") {
        const errMsg =
          event.content.length > 300
            ? event.content.slice(0, 300) + "…"
            : event.content;
        accumulated += `\n\n> **Error:** ${errMsg}`;
      }
    }
  } catch (err) {
    accumulated += `\n\n> **Error:** ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    // 无论成功还是失败，都释放并发锁
    sessionManager.release(userId);
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
    if (splitIndex < 1) {
      // 没有找到合适的换行符，或者换行符在最开头，则硬切
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    // 跳过换行符本身，避免下一段以 \n 开头
    remaining = remaining.slice(splitIndex).replace(/^\n/, "");
  }

  return chunks;
}
