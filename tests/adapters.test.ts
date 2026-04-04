import { describe, it, expect } from "vitest";
import {
  getAdapter,
  formatToolUse,
  claudeAdapter,
  type ParseState,
} from "../src/adapters.js";

// ── getAdapter ────────────────────────────────────────────────

describe("getAdapter", () => {
  it("returns claudeAdapter for 'claude'", () => {
    expect(getAdapter("claude").name).toBe("claude");
  });

  it("returns claudeAdapter for 'claude-internal'", () => {
    expect(getAdapter("claude-internal").name).toBe("claude");
  });

  it("returns claudeAdapter for 'claude-code'", () => {
    expect(getAdapter("claude-code").name).toBe("claude");
  });

  it("returns claudeAdapter for full path '/usr/local/bin/claude'", () => {
    expect(getAdapter("/usr/local/bin/claude").name).toBe("claude");
  });

  it("returns codexAdapter for 'codex'", () => {
    expect(getAdapter("codex").name).toBe("codex");
  });

  it("returns geminiAdapter for 'gemini'", () => {
    expect(getAdapter("gemini").name).toBe("gemini");
  });

  it("returns plainTextAdapter for unknown CLI", () => {
    expect(getAdapter("some-unknown-tool").name).toBe("plain-text");
  });

  it("matches via includes for path containing 'claude'", () => {
    expect(getAdapter("/path/to/my-claude-fork").name).toBe("claude");
  });
});

// ── formatToolUse ─────────────────────────────────────────────

describe("formatToolUse", () => {
  it("formats Bash with command", () => {
    const result = formatToolUse({ type: "tool_use", name: "Bash", input: { command: "ls -la" } });
    expect(result).toContain("**Bash**");
    expect(result).toContain("`ls -la`");
  });

  it("formats Read with file_path", () => {
    const result = formatToolUse({ type: "tool_use", name: "Read", input: { file_path: "/foo/bar.ts" } });
    expect(result).toContain("**Read**");
    expect(result).toContain("`/foo/bar.ts`");
  });

  it("formats Write with file_path", () => {
    const result = formatToolUse({ type: "tool_use", name: "Write", input: { file_path: "/foo/bar.ts" } });
    expect(result).toContain("**Write**");
    expect(result).toContain("`/foo/bar.ts`");
  });

  it("formats Grep with pattern", () => {
    const result = formatToolUse({ type: "tool_use", name: "Grep", input: { pattern: "TODO" } });
    expect(result).toContain("**Grep**");
    expect(result).toContain("`TODO`");
  });

  it("uses description as fallback", () => {
    const result = formatToolUse({ type: "tool_use", name: "Custom", input: { description: "doing stuff" } });
    expect(result).toContain("doing stuff");
  });

  it("shows just bold name when no input", () => {
    const result = formatToolUse({ type: "tool_use", name: "Mystery" });
    expect(result).toBe("> **Mystery**\n");
  });

  it("truncates Bash command over 80 chars", () => {
    const longCmd = "a".repeat(120);
    const result = formatToolUse({ type: "tool_use", name: "Bash", input: { command: longCmd } });
    // The backtick-wrapped portion should be 80 chars of the command
    expect(result).toContain("`" + "a".repeat(80) + "`");
    expect(result).not.toContain("a".repeat(81));
  });
});

// ── claudeAdapter.parseLine ───────────────────────────────────

describe("claudeAdapter.parseLine", () => {
  function makeState(): ParseState {
    return { blockTexts: new Map(), fullText: "", sessionId: "test-session" };
  }

  it("parses assistant event with text block", () => {
    const state = makeState();
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello world" }] },
    });
    const result = claudeAdapter.parseLine(line, state);
    expect(result).toEqual([
      { type: "text", content: "hello world", sessionId: "test-session" },
    ]);
  });

  it("parses tool_use block", () => {
    const state = makeState();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }],
      },
    });
    const result = claudeAdapter.parseLine(line, state);
    expect(result).toHaveLength(1);
    expect(result![0].type).toBe("tool");
    expect(result![0].content).toContain("Bash");
  });

  it("emits delta only for incremental text", () => {
    const state = makeState();

    // First event: "hel"
    const line1 = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hel" }] },
    });
    claudeAdapter.parseLine(line1, state);

    // Second event: "hello" (grew from "hel" to "hello")
    const line2 = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    const result = claudeAdapter.parseLine(line2, state);
    expect(result).toEqual([
      { type: "text", content: "lo", sessionId: "test-session" },
    ]);
  });

  it("parses result event as done", () => {
    const state = makeState();
    const line = JSON.stringify({ type: "result", result: "final answer" });
    const result = claudeAdapter.parseLine(line, state);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "done" }),
      ])
    );
  });

  it("returns null for invalid JSON", () => {
    const state = makeState();
    const result = claudeAdapter.parseLine("not json at all", state);
    expect(result).toBeNull();
  });

  it("handles mixed text and tool blocks", () => {
    const state = makeState();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me check..." },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    });
    const result = claudeAdapter.parseLine(line, state);
    expect(result).toHaveLength(2);
    expect(result![0].type).toBe("text");
    expect(result![1].type).toBe("tool");
  });
});
