import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionManager } from "../src/session.js";

describe("SessionManager", () => {
  let sm: SessionManager;

  // ── isUserAllowed ───────────────────────────────────────────

  describe("isUserAllowed", () => {
    afterEach(() => {
      delete process.env.ALLOWED_USERS;
    });

    it("allows everyone when ALLOWED_USERS is not set", () => {
      delete process.env.ALLOWED_USERS;
      sm = new SessionManager();
      expect(sm.isUserAllowed("anyone")).toBe(true);
    });

    it("allows a listed user", () => {
      process.env.ALLOWED_USERS = "alice,bob";
      sm = new SessionManager();
      expect(sm.isUserAllowed("alice")).toBe(true);
      expect(sm.isUserAllowed("bob")).toBe(true);
    });

    it("rejects an unlisted user", () => {
      process.env.ALLOWED_USERS = "alice,bob";
      sm = new SessionManager();
      expect(sm.isUserAllowed("charlie")).toBe(false);
    });

    it("trims whitespace in ALLOWED_USERS", () => {
      process.env.ALLOWED_USERS = " alice , bob ";
      sm = new SessionManager();
      expect(sm.isUserAllowed("alice")).toBe(true);
      expect(sm.isUserAllowed("bob")).toBe(true);
      expect(sm.isUserAllowed(" alice ")).toBe(false);
    });

    it("allows everyone when ALLOWED_USERS is empty string", () => {
      process.env.ALLOWED_USERS = "";
      sm = new SessionManager();
      expect(sm.isUserAllowed("anyone")).toBe(true);
    });
  });

  // ── tryAcquire / release / isProcessing ─────────────────────

  describe("concurrency control", () => {
    beforeEach(() => {
      delete process.env.ALLOWED_USERS;
      delete process.env.RATE_LIMIT_MAX;
      delete process.env.RATE_LIMIT_WINDOW_MS;
      sm = new SessionManager();
    });

    it("first acquire succeeds", () => {
      expect(sm.tryAcquire("user1")).toBe(true);
    });

    it("second acquire for same user fails", () => {
      sm.tryAcquire("user1");
      expect(sm.tryAcquire("user1")).toBe(false);
    });

    it("acquire succeeds after release", () => {
      sm.tryAcquire("user1");
      sm.release("user1");
      expect(sm.tryAcquire("user1")).toBe(true);
    });

    it("different users acquire independently", () => {
      expect(sm.tryAcquire("user1")).toBe(true);
      expect(sm.tryAcquire("user2")).toBe(true);
    });

    it("isProcessing reflects current state", () => {
      expect(sm.isProcessing("user1")).toBe(false);
      sm.tryAcquire("user1");
      expect(sm.isProcessing("user1")).toBe(true);
      sm.release("user1");
      expect(sm.isProcessing("user1")).toBe(false);
    });

    it("release on non-locked user is a no-op", () => {
      expect(() => sm.release("nobody")).not.toThrow();
    });
  });

  // ── checkRateLimit ──────────────────────────────────────────

  describe("checkRateLimit", () => {
    beforeEach(() => {
      delete process.env.ALLOWED_USERS;
      process.env.RATE_LIMIT_MAX = "3";
      process.env.RATE_LIMIT_WINDOW_MS = "60000";
      sm = new SessionManager();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      delete process.env.RATE_LIMIT_MAX;
      delete process.env.RATE_LIMIT_WINDOW_MS;
    });

    it("returns null for requests under the limit", () => {
      expect(sm.checkRateLimit("user1")).toBeNull();
      expect(sm.checkRateLimit("user1")).toBeNull();
      expect(sm.checkRateLimit("user1")).toBeNull();
    });

    it("returns wait seconds when over limit", () => {
      sm.checkRateLimit("user1");
      sm.checkRateLimit("user1");
      sm.checkRateLimit("user1");
      const wait = sm.checkRateLimit("user1");
      expect(wait).toBeTypeOf("number");
      expect(wait!).toBeGreaterThan(0);
    });

    it("allows requests again after window elapses", () => {
      sm.checkRateLimit("user1");
      sm.checkRateLimit("user1");
      sm.checkRateLimit("user1");
      expect(sm.checkRateLimit("user1")).not.toBeNull();

      vi.advanceTimersByTime(60001);
      expect(sm.checkRateLimit("user1")).toBeNull();
    });

    it("returns correct wait seconds (ceiling)", () => {
      vi.setSystemTime(new Date(0));
      sm.checkRateLimit("user1"); // t=0
      sm.checkRateLimit("user1"); // t=0
      sm.checkRateLimit("user1"); // t=0

      vi.advanceTimersByTime(30000); // t=30s
      const wait = sm.checkRateLimit("user1");
      // oldest is at t=0, window=60s, now=30s → wait = 60-30 = 30s
      expect(wait).toBe(30);
    });

    it("different users have independent limits", () => {
      sm.checkRateLimit("user1");
      sm.checkRateLimit("user1");
      sm.checkRateLimit("user1");
      expect(sm.checkRateLimit("user1")).not.toBeNull();
      expect(sm.checkRateLimit("user2")).toBeNull();
    });
  });

  // ── getSession / setSession ─────────────────────────────────

  describe("session management", () => {
    beforeEach(() => {
      delete process.env.ALLOWED_USERS;
      delete process.env.RATE_LIMIT_MAX;
      delete process.env.RATE_LIMIT_WINDOW_MS;
      sm = new SessionManager();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns null for unknown user", () => {
      expect(sm.getSession("unknown")).toBeNull();
    });

    it("returns sessionId after set", () => {
      sm.setSession("user1", "session-abc");
      expect(sm.getSession("user1")).toBe("session-abc");
    });

    it("increments messageCount on repeated set", () => {
      sm.setSession("user1", "s1");
      sm.setSession("user1", "s1");
      sm.setSession("user1", "s1");
      const info = sm.getSessionInfo("user1");
      expect(info?.messageCount).toBe(3);
    });

    it("returns null after TTL expires", () => {
      sm.setSession("user1", "s1");
      vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1); // TTL + 1ms
      expect(sm.getSession("user1")).toBeNull();
    });

    it("preserves original createdAt on update", () => {
      vi.setSystemTime(new Date(1000));
      sm.setSession("user1", "s1");
      vi.setSystemTime(new Date(5000));
      sm.setSession("user1", "s2");
      const info = sm.getSessionInfo("user1");
      expect(info?.createdAt).toBe(1000);
    });
  });

  // ── resetSession ────────────────────────────────────────────

  describe("resetSession", () => {
    beforeEach(() => {
      delete process.env.ALLOWED_USERS;
      sm = new SessionManager();
    });

    it("returns true and clears existing session", () => {
      sm.setSession("user1", "s1");
      expect(sm.resetSession("user1")).toBe(true);
      expect(sm.getSession("user1")).toBeNull();
    });

    it("returns false for nonexistent user", () => {
      expect(sm.resetSession("nobody")).toBe(false);
    });
  });

  // ── getSessionInfo ──────────────────────────────────────────

  describe("getSessionInfo", () => {
    beforeEach(() => {
      delete process.env.ALLOWED_USERS;
      sm = new SessionManager();
    });

    it("returns full SessionInfo after set", () => {
      sm.setSession("user1", "s1");
      const info = sm.getSessionInfo("user1");
      expect(info).not.toBeNull();
      expect(info!.sessionId).toBe("s1");
      expect(info!.messageCount).toBe(1);
      expect(info!.createdAt).toBeTypeOf("number");
      expect(info!.lastUsedAt).toBeTypeOf("number");
    });

    it("returns null for unknown user", () => {
      expect(sm.getSessionInfo("nobody")).toBeNull();
    });
  });

  // ── cleanup ─────────────────────────────────────────────────

  describe("cleanup", () => {
    beforeEach(() => {
      delete process.env.ALLOWED_USERS;
      delete process.env.RATE_LIMIT_MAX;
      delete process.env.RATE_LIMIT_WINDOW_MS;
      sm = new SessionManager();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("removes expired sessions and returns count", () => {
      sm.setSession("user1", "s1");
      sm.setSession("user2", "s2");
      vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);
      expect(sm.cleanup()).toBe(2);
      expect(sm.getSessionInfo("user1")).toBeNull();
    });

    it("keeps unexpired sessions", () => {
      vi.setSystemTime(new Date(0));
      sm.setSession("user1", "s1");

      vi.setSystemTime(new Date(60_000));
      sm.setSession("user2", "s2");

      // Advance to t = 2h + 1ms → user1 (lastUsed=0) expired, user2 (lastUsed=60s) still alive
      vi.setSystemTime(new Date(2 * 60 * 60 * 1000 + 1));
      expect(sm.cleanup()).toBe(1);
      expect(sm.getSessionInfo("user1")).toBeNull();
      expect(sm.getSessionInfo("user2")).not.toBeNull();
    });
  });
});
