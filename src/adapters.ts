import { spawn, ChildProcess } from "node:child_process";
import { v4 as uuidv4 } from "uuid";

// ── 通用类型 ─────────────────────────────────────────────────
export interface CLIStreamEvent {
  type: "text" | "tool" | "done" | "error";
  content: string;
  sessionId?: string;
}

// ── Claude JSON 流式输出类型 ─────────────────────────────────
interface ClaudeTextBlock {
  type: "text";
  text: string;
}

interface ClaudeToolUseBlock {
  type: "tool_use";
  name?: string;
  input?: Record<string, unknown>;
}

type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUseBlock;

interface ClaudeAssistantEvent {
  type: "assistant";
  message?: {
    content: ClaudeContentBlock[];
  };
}

interface ClaudeResultEvent {
  type: "result";
  result?: string;
}

type ClaudeStreamJSON = ClaudeAssistantEvent | ClaudeResultEvent;

/**
 * CLI 适配器接口 - 不同的 AI CLI 工具实现这个接口
 */
interface CLIAdapter {
  /** 适配器名称 */
  name: string;
  /** 构建命令行参数 */
  buildArgs(options: { sessionId: string; isResume: boolean; workDir: string }): string[];
  /** 解析 stdout 的一行输出，返回事件或 null */
  parseLine(line: string, state: ParseState): CLIStreamEvent | CLIStreamEvent[] | null;
}

export interface ParseState {
  /** 每个 text block 按索引独立跟踪已输出的文本 */
  blockTexts: Map<number, string>;
  /** 所有 text block 的完整文本拼接（用于 done 事件） */
  fullText: string;
  sessionId: string;
}

// ── Claude 适配器（claude / claude-internal）─────────────────
export const claudeAdapter: CLIAdapter = {
  name: "claude",

  buildArgs({ sessionId, isResume, workDir }) {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
    ];

    // 仅在用户显式启用时跳过权限检查（默认安全）
    if (process.env.SKIP_PERMISSIONS === "true") {
      args.push("--dangerously-skip-permissions");
    }

    // 系统提示
    args.push("--append-system-prompt", buildSystemPrompt(workDir));

    if (isResume) {
      args.push("--resume", sessionId);
    } else {
      args.push("--session-id", sessionId);
    }
    return args;
  },

  parseLine(line, state) {
    let data: ClaudeStreamJSON;
    try {
      data = JSON.parse(line) as ClaudeStreamJSON;
    } catch {
      return null;
    }

    const events: CLIStreamEvent[] = [];

    if (data.type === "assistant" && data.message?.content) {
      let blockIndex = 0;
      for (const block of data.message.content) {
        if (block.type === "text" && block.text) {
          const newText = block.text;
          const prevText = state.blockTexts.get(blockIndex) || "";

          if (newText.length > prevText.length) {
            const delta = newText.slice(prevText.length);
            state.blockTexts.set(blockIndex, newText);
            events.push({ type: "text", content: delta, sessionId: state.sessionId });
          } else if (prevText === "" && newText.length > 0) {
            state.blockTexts.set(blockIndex, newText);
            events.push({ type: "text", content: newText, sessionId: state.sessionId });
          }
          blockIndex++;
        } else if (block.type === "tool_use") {
          const hint = formatToolUse(block);
          events.push({ type: "tool", content: hint, sessionId: state.sessionId });
        }
      }
      state.fullText = Array.from(state.blockTexts.values()).join("");
    } else if (data.type === "result") {
      const resultData = data as ClaudeResultEvent;
      if (resultData.result && state.fullText === "") {
        events.push({ type: "text", content: resultData.result, sessionId: state.sessionId });
      }
      events.push({ type: "done", content: state.fullText || resultData.result || "", sessionId: state.sessionId });
    }

    return events.length > 0 ? events : null;
  },
};

// ── Codex 适配器 (OpenAI Codex CLI) ─────────────────────────
const codexAdapter: CLIAdapter = {
  name: "codex",

  buildArgs() {
    return ["-q", "--full-auto"];
  },

  parseLine(line, state) {
    if (!line.trim()) return null;
    state.fullText += line + "\n";
    return { type: "text", content: line + "\n", sessionId: state.sessionId };
  },
};

// ── Gemini CLI 适配器 ────────────────────────────────────────
const geminiAdapter: CLIAdapter = {
  name: "gemini",

  buildArgs() {
    return [];
  },

  parseLine(line, state) {
    if (!line.trim()) return null;
    state.fullText += line + "\n";
    return { type: "text", content: line + "\n", sessionId: state.sessionId };
  },
};

// ── 纯文本 Fallback 适配器（兼容未知 CLI）────────────────────
const plainTextAdapter: CLIAdapter = {
  name: "plain-text",

  buildArgs() {
    return [];
  },

  parseLine(line, state) {
    if (!line.trim()) return null;
    state.fullText += line + "\n";
    return { type: "text", content: line + "\n", sessionId: state.sessionId };
  },
};

// ── 适配器注册表 ─────────────────────────────────────────────
const ADAPTERS: Record<string, CLIAdapter> = {
  "claude": claudeAdapter,
  "claude-internal": claudeAdapter,
  "claude-code": claudeAdapter,
  "codex": codexAdapter,
  "gemini": geminiAdapter,
};

/**
 * 根据 CLI 路径自动匹配适配器
 */
export function getAdapter(cliPath: string): CLIAdapter {
  const cmdName = cliPath.split("/").pop()?.toLowerCase() || "";

  if (ADAPTERS[cmdName]) return ADAPTERS[cmdName];

  for (const [key, adapter] of Object.entries(ADAPTERS)) {
    if (cmdName.includes(key)) return adapter;
  }

  return plainTextAdapter;
}

// ── 工具函数 ─────────────────────────────────────────────────
function getWorkDir(): string {
  return process.env.CLAUDE_WORK_DIR || process.env.HOME || process.cwd();
}

function getCLIPath(): string {
  return process.env.CLI_PATH || "claude";
}

/** 子进程超时时间（毫秒），默认 5 分钟 */
function getCLITimeout(): number {
  const val = parseInt(process.env.CLI_TIMEOUT_MS || "", 10);
  return val > 0 ? val : 5 * 60 * 1000;
}

function buildSystemPrompt(workDir: string): string {
  return `你是一个通过聊天平台远程控制的 AI 开发助手。你运行在用户的电脑上，可以帮用户完成各种开发任务。

你的能力：
- 创建/编辑/读取文件和目录
- 执行 shell 命令（git、npm、编译等）
- 帮助开发项目、修 bug、写代码

注意事项：
- 你的工作目录必须是: ${workDir}，所有文件操作都应该在这个目录下进行
- 每次执行命令时，先 cd 到 ${workDir}
- 你的回复会显示在聊天平台中，请注意格式简洁
- 执行危险操作前（删除文件、force push 等）请先确认
- 如果任务复杂，先简要说明计划再执行`;
}

export function formatToolUse(block: ClaudeToolUseBlock): string {
  const toolName = block.name || "tool";
  let toolDesc = "";
  const input = block.input as Record<string, string> | undefined;

  if (toolName === "Bash" && input?.command) {
    toolDesc = `\`${input.command.slice(0, 80)}\``;
  } else if ((toolName === "Read" || toolName === "Write" || toolName === "Edit") && input?.file_path) {
    toolDesc = `\`${input.file_path}\``;
  } else if ((toolName === "Glob" || toolName === "Grep") && input?.pattern) {
    toolDesc = `\`${input.pattern}\``;
  } else if (input?.description) {
    toolDesc = String(input.description);
  }
  return toolDesc ? `> **${toolName}**: ${toolDesc}\n` : `> **${toolName}**\n`;
}

// ── 活跃子进程追踪（用于 graceful shutdown）──────────────────
const activeChildren = new Set<ChildProcess>();

/** 终止所有活跃子进程 */
export function killAllChildren(): void {
  for (const child of activeChildren) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
}

// ── 主函数：流式调用 CLI ─────────────────────────────────────
export async function* streamCLI(
  prompt: string,
  options: {
    sessionId?: string;
    cwd?: string;
  } = {}
): AsyncGenerator<CLIStreamEvent> {
  const cliPath = getCLIPath();
  const adapter = getAdapter(cliPath);
  const workDir = getWorkDir();
  const sessionId = options.sessionId || uuidv4();
  const isResume = !!options.sessionId;

  const args = adapter.buildArgs({ sessionId, isResume, workDir });

  const cwd = options.cwd || workDir;
  console.log(`[${adapter.name}] 启动子进程: ${cliPath}, cwd=${cwd}`);

  const child: ChildProcess = spawn(cliPath, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  activeChildren.add(child);

  // 子进程超时自动 kill
  const timeoutMs = getCLITimeout();
  const timeout = setTimeout(() => {
    if (child.exitCode === null) {
      console.warn(`[${adapter.name}] 子进程超时 (${timeoutMs}ms)，强制终止`);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 3000);
    }
  }, timeoutMs);

  // 写入 prompt
  if (child.stdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  }

  const state: ParseState = { blockTexts: new Map(), fullText: "", sessionId };
  let buffer = "";

  const textQueue: CLIStreamEvent[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const push = (event: CLIStreamEvent) => {
    textQueue.push(event);
    if (resolve) {
      resolve();
      resolve = null;
    }
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const result = adapter.parseLine(line, state);
        if (result) {
          const events = Array.isArray(result) ? result : [result];
          events.forEach(push);
        }
      } catch {
        if (adapter.name !== "claude") {
          state.fullText += line + "\n";
          push({ type: "text", content: line + "\n", sessionId });
        }
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const msg = chunk.toString("utf-8");
    if (msg.includes("Error") || msg.includes("error")) {
      const firstMeaningfulLine =
        msg.split("\n").find((l) => l.trim().length > 0) || msg;
      const summary =
        firstMeaningfulLine.length > 300
          ? firstMeaningfulLine.slice(0, 300) + "…"
          : firstMeaningfulLine;
      push({ type: "error", content: summary, sessionId });
    }
  });

  child.on("close", (code) => {
    clearTimeout(timeout);
    activeChildren.delete(child);
    if (!done) {
      if (code !== 0 && textQueue.length === 0) {
        push({ type: "error", content: `${cliPath} exited with code ${code}`, sessionId });
      }
      const hasDone = textQueue.some((e) => e.type === "done");
      if (!hasDone) {
        push({ type: "done", content: state.fullText, sessionId });
      }
      done = true;
    }
  });

  // AsyncGenerator yield loop
  try {
    while (true) {
      if (textQueue.length > 0) {
        const event = textQueue.shift()!;
        yield event;
        if (event.type === "done" || event.type === "error") break;
      } else if (done) {
        break;
      } else {
        await new Promise<void>((r) => { resolve = r; });
      }
    }
  } finally {
    clearTimeout(timeout);
    activeChildren.delete(child);
    if (child.exitCode === null) {
      child.kill();
    }
  }
}

// 保持向后兼容的别名
export { CLIStreamEvent as ClaudeStreamEvent };
export const streamClaude = streamCLI;
