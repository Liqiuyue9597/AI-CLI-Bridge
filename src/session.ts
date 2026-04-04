/**
 * 会话管理器 - 管理用户会话、并发控制、速率限制
 */

interface SessionInfo {
  sessionId: string;
  createdAt: number;
  lastUsedAt: number;
  messageCount: number;
}

/** 速率限制配置 */
interface RateLimitConfig {
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大请求数 */
  maxRequests: number;
}

interface RateLimitEntry {
  timestamps: number[];
}

class SessionManager {
  private sessions = new Map<string, SessionInfo>();

  /** 用户正在处理中的请求锁 */
  private processing = new Set<string>();

  /** 速率限制追踪 */
  private rateLimits = new Map<string, RateLimitEntry>();

  // 默认会话过期时间：2 小时
  private readonly TTL_MS = 2 * 60 * 60 * 1000;

  /** 速率限制配置 */
  private readonly rateLimit: RateLimitConfig;

  /** 用户白名单（null 表示不限制） */
  private readonly allowedUsers: Set<string> | null;

  constructor() {
    // 从环境变量读取速率限制配置
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "", 10);
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX || "", 10);
    this.rateLimit = {
      windowMs: windowMs > 0 ? windowMs : 60_000,       // 默认 1 分钟
      maxRequests: maxRequests > 0 ? maxRequests : 5,     // 默认每窗口 5 次
    };

    // 从环境变量读取用户白名单
    const allowedUsersEnv = process.env.ALLOWED_USERS;
    if (allowedUsersEnv) {
      this.allowedUsers = new Set(
        allowedUsersEnv.split(",").map((s) => s.trim()).filter(Boolean)
      );
    } else {
      this.allowedUsers = null;
    }
  }

  // ── 用户鉴权 ────────────────────────────────────────────────

  /**
   * 检查用户是否被允许使用 bot
   * 如果未配置 ALLOWED_USERS，则所有用户都允许
   */
  isUserAllowed(userId: string): boolean {
    if (!this.allowedUsers) return true;
    return this.allowedUsers.has(userId);
  }

  // ── 并发控制 ────────────────────────────────────────────────

  /**
   * 尝试获取用户的处理锁
   * @returns true 如果成功获取锁，false 如果用户已有请求在处理中
   */
  tryAcquire(userId: string): boolean {
    if (this.processing.has(userId)) return false;
    this.processing.add(userId);
    return true;
  }

  /**
   * 释放用户的处理锁
   */
  release(userId: string): void {
    this.processing.delete(userId);
  }

  /**
   * 检查用户是否正在处理请求
   */
  isProcessing(userId: string): boolean {
    return this.processing.has(userId);
  }

  // ── 速率限制 ────────────────────────────────────────────────

  /**
   * 检查用户是否超过速率限制
   * @returns null 如果未超限，否则返回需要等待的秒数
   */
  checkRateLimit(userId: string): number | null {
    const now = Date.now();
    let entry = this.rateLimits.get(userId);

    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(userId, entry);
    }

    // 清理窗口外的时间戳
    entry.timestamps = entry.timestamps.filter(
      (t) => now - t < this.rateLimit.windowMs
    );

    if (entry.timestamps.length >= this.rateLimit.maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const waitMs = this.rateLimit.windowMs - (now - oldestInWindow);
      return Math.ceil(waitMs / 1000);
    }

    entry.timestamps.push(now);
    return null;
  }

  // ── 会话管理 ────────────────────────────────────────────────

  /**
   * 获取用户当前的 session ID（如果存在且未过期）
   */
  getSession(userId: string): string | null {
    const info = this.sessions.get(userId);
    if (!info) return null;

    if (Date.now() - info.lastUsedAt > this.TTL_MS) {
      this.sessions.delete(userId);
      return null;
    }

    return info.sessionId;
  }

  /**
   * 创建或更新会话
   */
  setSession(userId: string, sessionId: string): void {
    const existing = this.sessions.get(userId);
    this.sessions.set(userId, {
      sessionId,
      createdAt: existing?.createdAt || Date.now(),
      lastUsedAt: Date.now(),
      messageCount: (existing?.messageCount || 0) + 1,
    });
  }

  /**
   * 重置用户会话
   */
  resetSession(userId: string): boolean {
    return this.sessions.delete(userId);
  }

  /**
   * 获取会话信息（用于 /status 等）
   */
  getSessionInfo(userId: string): SessionInfo | null {
    return this.sessions.get(userId) || null;
  }

  /**
   * 清理所有过期会话和速率限制记录
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    // 清理过期会话
    for (const [key, info] of this.sessions) {
      if (now - info.lastUsedAt > this.TTL_MS) {
        this.sessions.delete(key);
        cleaned++;
      }
    }

    // 清理过期的速率限制记录
    for (const [key, entry] of this.rateLimits) {
      entry.timestamps = entry.timestamps.filter(
        (t) => now - t < this.rateLimit.windowMs
      );
      if (entry.timestamps.length === 0) {
        this.rateLimits.delete(key);
      }
    }

    return cleaned;
  }
}

// 单例
export const sessionManager = new SessionManager();
