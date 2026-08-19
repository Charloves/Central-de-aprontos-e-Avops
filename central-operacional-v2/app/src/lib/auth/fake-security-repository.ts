import type {
  AuthAuditEventType,
  AuthSecurityConfig,
  AuthSecurityContext,
  AuthSecurityRepository,
  BlockCheckResult,
  LoginFailureResult,
  PersistentSessionRecord,
} from './security';
import type { AuthProfile } from './profiles';

type Bucket = {
  failures: number;
  windowEndsAt: number;
};

type Block = {
  key: string;
  windowStartedAt: number;
  blockedUntil: number;
  failedAttempts: number;
  liftedAt: number | null;
  liftedReason: 'EXPIRED' | 'LOGIN_SUCCESS' | null;
};

type SessionRecord = PersistentSessionRecord & {
  sessionIdentifierHash: string;
  nonceHash: string;
  lastSeenAt: string | null;
};

export class FakeAuthSecurityRepository implements AuthSecurityRepository {
  readonly auditEvents: Array<{
    eventType: AuthAuditEventType;
    result: string;
    profileId?: string | null;
    sessionId?: string | null;
    reason?: string | null;
    context?: AuthSecurityContext | null;
    metadata?: Record<string, string | number | boolean | null>;
    now?: Date;
  }> = [];

  private readonly buckets = new Map<string, Bucket>();
  private readonly blocks = new Map<string, Block>();
  private readonly blockHistory: Block[] = [];
  private readonly sessions = new Map<string, SessionRecord>();

  failNext = false;

  getLastSeenForTest(sessionIdentifierHash: string): string | null {
    return this.sessions.get(sessionIdentifierHash)?.lastSeenAt ?? null;
  }

  getBlocksForTest(): Array<{
    key: string;
    windowStartedAt: string;
    blockedUntil: string;
    failedAttempts: number;
    liftedAt: string | null;
    liftedReason: Block['liftedReason'];
  }> {
    return this.blockHistory.map((block) => ({
      key: block.key,
      windowStartedAt: new Date(block.windowStartedAt).toISOString(),
      blockedUntil: new Date(block.blockedUntil).toISOString(),
      failedAttempts: block.failedAttempts,
      liftedAt: block.liftedAt === null ? null : new Date(block.liftedAt).toISOString(),
      liftedReason: block.liftedReason,
    }));
  }

  async checkTemporaryBlock(input: {
    context: AuthSecurityContext;
    config: AuthSecurityConfig;
    now?: Date;
  }): Promise<BlockCheckResult> {
    this.throwIfRequested();
    const now = (input.now ?? new Date()).getTime();
    this.closeExpiredBlocks(input.context, input.config, now);
    const block = this.blockKeys(input.context, input.config)
      .map((key) => this.blocks.get(key))
      .find((candidate) => candidate && candidate.blockedUntil > now);
    return {
      blocked: Boolean(block),
      blockedUntil: block ? new Date(block.blockedUntil).toISOString() : null,
      scope: block ? 'COMBINED' : null,
    };
  }

  async recordLoginFailure(input: {
    context: AuthSecurityContext;
    config: AuthSecurityConfig;
    reason: string;
    now?: Date;
  }): Promise<LoginFailureResult> {
    this.throwIfRequested();
    const now = (input.now ?? new Date()).getTime();
    this.closeExpiredBlocks(input.context, input.config, now);
    const activeBlock = this.blockKeys(input.context, input.config)
      .map((key) => this.blocks.get(key))
      .find((candidate) => candidate && candidate.blockedUntil > now);
    if (activeBlock) {
      await this.recordAuditEvent({
        eventType: 'LOGIN_BLOCKED',
        result: 'NEGADO',
        context: input.context,
        reason: 'TEMPORARY_BLOCK',
        now: input.now,
      });
      return { blocked: true, blockedUntil: new Date(activeBlock.blockedUntil).toISOString() };
    }
    const windowStartedAt = Math.floor(now / (input.config.windowSeconds * 1000)) * input.config.windowSeconds * 1000;
    const windowEndsAt = windowStartedAt + input.config.windowSeconds * 1000;
    let blocked = false;

    for (const key of this.blockKeys(input.context, input.config)) {
      const current = this.buckets.get(`${key}:${windowStartedAt}`) ?? { failures: 0, windowEndsAt };
      current.failures += 1;
      this.buckets.set(`${key}:${windowStartedAt}`, current);
      if (current.failures >= input.config.maxAttempts) {
        blocked = true;
        if (!this.blocks.has(key)) {
          const block: Block = {
            key,
            windowStartedAt,
            blockedUntil: now + input.config.blockSeconds * 1000,
            failedAttempts: current.failures,
            liftedAt: null,
            liftedReason: null,
          };
          this.blocks.set(key, block);
          this.blockHistory.push(block);
        }
      }
    }

    await this.recordAuditEvent({
      eventType: blocked ? 'LOGIN_BLOCKED' : 'LOGIN_FAILURE',
      result: 'NEGADO',
      context: input.context,
      reason: input.reason,
      now: input.now,
    });

    return {
      blocked,
      blockedUntil: blocked ? new Date(now + input.config.blockSeconds * 1000).toISOString() : null,
    };
  }

  async recordLoginSuccess(input: {
    context: AuthSecurityContext;
    config: AuthSecurityConfig;
    profile: AuthProfile;
    sessionExpiresAt: string;
    sessionIdentifierHash: string;
    nonceHash: string;
    now?: Date;
  }): Promise<{ sessionId: string }> {
    this.throwIfRequested();
    const now = input.now ?? new Date();
    this.closeExpiredBlocks(input.context, input.config, now.getTime());
    const activeBlock = this.blockKeys(input.context, input.config)
      .map((key) => this.blocks.get(key))
      .find((candidate) => candidate && candidate.blockedUntil > now.getTime());
    if (activeBlock) throw new Error('authentication blocked');
    for (const key of this.blockKeys(input.context, input.config).filter((key) => !key.startsWith('NETWORK:'))) {
      for (const bucketKey of Array.from(this.buckets.keys()).filter((bucketKey) => bucketKey.startsWith(`${key}:`))) {
        this.buckets.delete(bucketKey);
      }
      const block = this.blocks.get(key);
      if (block) {
        block.liftedAt = now.getTime();
        block.liftedReason = 'LOGIN_SUCCESS';
        this.blocks.delete(key);
      }
    }
    const sessionId = `session-${this.sessions.size + 1}`;
    this.sessions.set(input.sessionIdentifierHash, {
      sessionId,
      profileId: input.profile.id,
      sessionIdentifierHash: input.sessionIdentifierHash,
      nonceHash: input.nonceHash,
      expiresAt: input.sessionExpiresAt,
      revokedAt: null,
      lastSeenAt: null,
    });
    await this.recordAuditEvent({
      eventType: 'LOGIN_SUCCESS',
      result: 'OK',
      profileId: input.profile.id,
      sessionId,
      context: input.context,
      now,
    });
    return { sessionId };
  }

  async touchSession(input: { sessionIdentifierHash: string; touchIntervalSeconds: number; now?: Date }): Promise<PersistentSessionRecord | null> {
    this.throwIfRequested();
    const session = this.sessions.get(input.sessionIdentifierHash);
    const now = input.now ?? new Date();
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= now.getTime()) return null;
    if (!session.lastSeenAt || Date.parse(session.lastSeenAt) <= now.getTime() - input.touchIntervalSeconds * 1000) {
      session.lastSeenAt = now.toISOString();
    }
    return session;
  }

  async revokeSession(input: { sessionIdentifierHash: string; reason: string; now?: Date }): Promise<{ sessionId: string | null }> {
    this.throwIfRequested();
    const session = this.sessions.get(input.sessionIdentifierHash);
    if (!session) return { sessionId: null };
    session.revokedAt = (input.now ?? new Date()).toISOString();
    await this.recordAuditEvent({
      eventType: 'LOGOUT',
      result: 'OK',
      profileId: session.profileId,
      sessionId: session.sessionId,
      reason: input.reason,
      now: input.now,
    });
    return { sessionId: session.sessionId };
  }

  async revokeProfileSessions(input: { profileId: string; reason: string; now?: Date }): Promise<{ revokedCount: number }> {
    let revokedCount = 0;
    for (const session of this.sessions.values()) {
      if (session.profileId === input.profileId && !session.revokedAt) {
        session.revokedAt = (input.now ?? new Date()).toISOString();
        revokedCount += 1;
      }
    }
    return { revokedCount };
  }

  async recordAuditEvent(input: Parameters<AuthSecurityRepository['recordAuditEvent']>[0]): Promise<void> {
    this.throwIfRequested();
    this.auditEvents.push(input);
  }

  private blockKeys(context: AuthSecurityContext, config: AuthSecurityConfig): string[] {
    const keys: string[] = [];
    if (config.enableTrigramScope) keys.push(`TRIGRAM:${context.trigramFingerprint}`);
    if (config.enableNetworkScope && context.networkFingerprint) keys.push(`NETWORK:${context.networkFingerprint}`);
    if (config.enableTrigramScope && config.enableNetworkScope && context.networkFingerprint) {
      keys.push(`COMBINED:${context.trigramFingerprint}:${context.networkFingerprint}`);
    }
    return keys;
  }

  private closeExpiredBlocks(context: AuthSecurityContext, config: AuthSecurityConfig, now: number): void {
    for (const key of this.blockKeys(context, config)) {
      const block = this.blocks.get(key);
      if (block && block.blockedUntil <= now) {
        block.liftedAt = now;
        block.liftedReason = 'EXPIRED';
        this.blocks.delete(key);
      }
    }
  }

  private throwIfRequested(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('database unavailable');
    }
  }
}
