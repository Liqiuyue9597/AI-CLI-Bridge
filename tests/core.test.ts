import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { splitMessage, preCheck } from "../src/core.js";
import { sessionManager } from "../src/session.js";

// ── splitMessage ──────────────────────────────────────────────

describe("splitMessage", () => {
  it("returns single chunk for short text", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("splits at newline boundary when possible", () => {
    const text = "aaa\nbbb\nccc";
    const chunks = splitMessage(text, 8);
    // "aaa\nbbb" fits within 8, split at last \n before 8 → "aaa\nbbb"
    expect(chunks[0]).toBe("aaa\nbbb");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("hard-splits when no newline is found", () => {
    const text = "a".repeat(20);
    const chunks = splitMessage(text, 10);
    expect(chunks[0]).toBe("a".repeat(10));
    expect(chunks[1]).toBe("a".repeat(10));
  });

  it("strips leading newline from subsequent chunks", () => {
    // "aaaa\nbbbb" with maxLength=5 → should split at \n
    const text = "aaaa\nbbbb";
    const chunks = splitMessage(text, 5);
    expect(chunks[0]).toBe("aaaa");
    // Subsequent chunk should not start with \n
    expect(chunks[1]).not.toMatch(/^\n/);
    expect(chunks[1]).toBe("bbbb");
  });

  it("handles empty string", () => {
    const chunks = splitMessage("");
    expect(chunks).toEqual([]);
  });

  it("respects custom maxLength parameter", () => {
    const text = "a".repeat(100);
    const chunks = splitMessage(text, 30);
    expect(chunks.length).toBe(4); // ceil(100/30) = 4
    expect(chunks[0].length).toBe(30);
  });

  it("returns single chunk when text equals maxLength", () => {
    const text = "a".repeat(50);
    expect(splitMessage(text, 50)).toEqual([text]);
  });

  it("produces multiple chunks for very long text", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const chunks = splitMessage(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    // Reassemble should reproduce original (minus split-consumed newlines)
    const reassembled = chunks.join("\n");
    expect(reassembled).toBe(text);
  });

  it("hard-splits when newline is at position 0", () => {
    const text = "\n" + "a".repeat(10);
    const chunks = splitMessage(text, 5);
    // splitIndex < 1 → hard split at maxLength
    expect(chunks[0].length).toBe(5);
  });

  it("handles text that is only newlines", () => {
    const text = "\n\n\n";
    const chunks = splitMessage(text, 2);
    // Should not infinite loop
    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ── preCheck ──────────────────────────────────────────────────

describe("preCheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // clean up any acquired locks
    sessionManager.release("test-user");
  });

  it("returns ok when all checks pass", () => {
    vi.spyOn(sessionManager, "isUserAllowed").mockReturnValue(true);
    vi.spyOn(sessionManager, "checkRateLimit").mockReturnValue(null);
    vi.spyOn(sessionManager, "tryAcquire").mockReturnValue(true);

    const result = preCheck("test-user");
    expect(result.ok).toBe(true);
  });

  it("rejects when user is not allowed", () => {
    vi.spyOn(sessionManager, "isUserAllowed").mockReturnValue(false);

    const result = preCheck("test-user");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("权限");
  });

  it("rejects when rate limited", () => {
    vi.spyOn(sessionManager, "isUserAllowed").mockReturnValue(true);
    vi.spyOn(sessionManager, "checkRateLimit").mockReturnValue(30);

    const result = preCheck("test-user");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("30");
  });

  it("rejects when already processing", () => {
    vi.spyOn(sessionManager, "isUserAllowed").mockReturnValue(true);
    vi.spyOn(sessionManager, "checkRateLimit").mockReturnValue(null);
    vi.spyOn(sessionManager, "tryAcquire").mockReturnValue(false);

    const result = preCheck("test-user");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("处理中");
  });
});
