/**
 * 会话管理器 - 管理 Discord 用户与 Claude session 的映射关系
 */

interface SessionInfo {
  sessionId: string;
  createdAt: number;
  lastUsedAt: number;
  messageCount: number;
}

class SessionManager {
  // key: Discord userId (或 userId:channelId)
  private sessions = new Map<string, SessionInfo>();

  // 默认会话过期时间：2 小时
  private readonly TTL_MS = 2 * 60 * 60 * 1000;

  /**
   * 生成会话 key（按用户隔离，同一用户在不同频道共享会话）
   */
  private getKey(userId: string): string {
    return userId;
  }

  /**
   * 获取用户当前的 session ID（如果存在且未过期）
   */
  getSession(userId: string): string | null {
    const key = this.getKey(userId);
    const info = this.sessions.get(key);
    if (!info) return null;

    // 检查是否过期
    if (Date.now() - info.lastUsedAt > this.TTL_MS) {
      this.sessions.delete(key);
      return null;
    }

    return info.sessionId;
  }

  /**
   * 创建或更新会话
   */
  setSession(userId: string, sessionId: string): void {
    const key = this.getKey(userId);
    const existing = this.sessions.get(key);
    this.sessions.set(key, {
      sessionId,
      createdAt: existing?.createdAt || Date.now(),
      lastUsedAt: Date.now(),
      messageCount: (existing?.messageCount || 0) + 1,
    });
  }

  /**
   * 更新最后使用时间
   */
  touch(userId: string): void {
    const key = this.getKey(userId);
    const info = this.sessions.get(key);
    if (info) {
      info.lastUsedAt = Date.now();
      info.messageCount++;
    }
  }

  /**
   * 重置用户会话
   */
  resetSession(userId: string): boolean {
    const key = this.getKey(userId);
    return this.sessions.delete(key);
  }

  /**
   * 获取会话信息（用于 /status 等）
   */
  getSessionInfo(userId: string): SessionInfo | null {
    const key = this.getKey(userId);
    return this.sessions.get(key) || null;
  }

  /**
   * 清理所有过期会话
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, info] of this.sessions) {
      if (now - info.lastUsedAt > this.TTL_MS) {
        this.sessions.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// 单例
export const sessionManager = new SessionManager();
