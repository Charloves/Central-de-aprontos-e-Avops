import { createHmac } from 'node:crypto';
import { normalizeTrigram } from '@/lib/domain/normalization';
import type { AuthProfile } from './profiles';
import type { SessionPayload } from './session';

export const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
export const DEFAULT_LOGIN_WINDOW_SECONDS = 15 * 60;
export const DEFAULT_LOGIN_BLOCK_SECONDS = 15 * 60;
export const DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS = 5 * 60;

export type AuthScope = 'TRIGRAM' | 'NETWORK' | 'COMBINED';
export type AuthAuditEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGIN_BLOCKED'
  | 'LOGOUT'
  | 'SESSION_REVOKED'
  | 'SESSION_EXPIRED';

export type AuthSecurityConfig = {
  fingerprintSecret: string;
  maxAttempts: number;
  windowSeconds: number;
  blockSeconds: number;
  sessionTouchIntervalSeconds: number;
  enableTrigramScope: boolean;
  enableNetworkScope: boolean;
};

export type AuthSecurityContext = {
  trigramFingerprint: string;
  networkFingerprint: string | null;
  userAgentFingerprint: string | null;
};

export type BlockCheckResult = {
  blocked: boolean;
  blockedUntil: string | null;
  scope: AuthScope | null;
};

export type LoginFailureResult = {
  blocked: boolean;
  blockedUntil: string | null;
};

export type PersistentSessionRecord = {
  sessionId: string;
  profileId: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type AuthSecurityRepository = {
  checkTemporaryBlock(input: {
    context: AuthSecurityContext;
    config: AuthSecurityConfig;
    now?: Date;
  }): Promise<BlockCheckResult>;
  recordLoginFailure(input: {
    context: AuthSecurityContext;
    config: AuthSecurityConfig;
    reason: string;
    now?: Date;
  }): Promise<LoginFailureResult>;
  recordLoginSuccess(input: {
    context: AuthSecurityContext;
    config: AuthSecurityConfig;
    profile: AuthProfile;
    session: SessionPayload;
    sessionIdentifierHash: string;
    nonceHash: string;
    now?: Date;
  }): Promise<{ sessionId: string }>;
  touchSession(input: {
    nonceHash: string;
    touchIntervalSeconds: number;
    now?: Date;
  }): Promise<PersistentSessionRecord | null>;
  revokeSession(input: {
    nonceHash: string;
    reason: string;
    now?: Date;
  }): Promise<{ sessionId: string | null }>;
  revokeProfileSessions(input: {
    profileId: string;
    reason: string;
    now?: Date;
  }): Promise<{ revokedCount: number }>;
  recordAuditEvent(input: {
    eventType: AuthAuditEventType;
    result: string;
    profileId?: string | null;
    sessionId?: string | null;
    context?: AuthSecurityContext | null;
    reason?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
    now?: Date;
  }): Promise<void>;
};

export type TrustedNetworkOriginProvider = {
  getNetworkOrigin(request: Request): string | null;
};

export function loadAuthSecurityConfig(env: NodeJS.ProcessEnv = process.env): AuthSecurityConfig {
  const fingerprintSecret = validateFingerprintSecret(env.AUTH_FINGERPRINT_SECRET, env.SESSION_SECRET);
  return {
    fingerprintSecret,
    maxAttempts: readPositiveInteger(env.LOGIN_MAX_ATTEMPTS, DEFAULT_LOGIN_MAX_ATTEMPTS),
    windowSeconds: readPositiveInteger(env.LOGIN_WINDOW_SECONDS, DEFAULT_LOGIN_WINDOW_SECONDS),
    blockSeconds: readPositiveInteger(env.LOGIN_BLOCK_SECONDS, DEFAULT_LOGIN_BLOCK_SECONDS),
    sessionTouchIntervalSeconds: readPositiveInteger(
      env.SESSION_TOUCH_INTERVAL_SECONDS,
      DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS,
    ),
    enableTrigramScope: readBoolean(env.AUTH_RATE_LIMIT_TRIGRAM_ENABLED, true),
    enableNetworkScope: readBoolean(env.AUTH_RATE_LIMIT_NETWORK_ENABLED, true),
  };
}

export function validateFingerprintSecret(
  secret: string | undefined,
  sessionSecret: string | undefined,
): string {
  if (!secret) throw new Error('AUTH_FINGERPRINT_SECRET ausente.');
  if (secret.length < 32) throw new Error('AUTH_FINGERPRINT_SECRET deve ter pelo menos 32 caracteres.');
  if (/^(.)\1+$/.test(secret)) throw new Error('AUTH_FINGERPRINT_SECRET fraco.');
  if (sessionSecret && secret === sessionSecret) {
    throw new Error('AUTH_FINGERPRINT_SECRET deve ser diferente de SESSION_SECRET.');
  }
  return secret;
}

export function buildAuthSecurityContext(input: {
  trigram: string;
  networkOrigin: string | null;
  userAgent: string | null;
  config: AuthSecurityConfig;
}): AuthSecurityContext {
  const normalizedTrigram = normalizeTrigram(input.trigram);
  return {
    trigramFingerprint: fingerprintAuthValue('trigram', normalizedTrigram || 'INVALID_TRIGRAM', input.config.fingerprintSecret),
    networkFingerprint: input.networkOrigin
      ? fingerprintAuthValue('network', input.networkOrigin, input.config.fingerprintSecret)
      : null,
    userAgentFingerprint: input.userAgent
      ? fingerprintAuthValue('user-agent', input.userAgent, input.config.fingerprintSecret)
      : null,
  };
}

export function getSessionHashes(session: SessionPayload, fingerprintSecret: string): {
  sessionIdentifierHash: string;
  nonceHash: string;
} {
  return {
    sessionIdentifierHash: fingerprintAuthValue('session', `${session.trigram}:${session.nonce}`, fingerprintSecret),
    nonceHash: fingerprintAuthValue('nonce', session.nonce, fingerprintSecret),
  };
}

export function fingerprintAuthValue(purpose: string, value: string, secret: string): string {
  return createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex');
}

export function resolveTrustedNetworkOrigin(input: {
  request: Request;
  provider?: TrustedNetworkOriginProvider;
  environment?: string;
}): string | null {
  if (input.provider) return input.provider.getNetworkOrigin(input.request);
  if (input.environment === 'production') return null;
  return 'LOCAL_DEVELOPMENT_NETWORK';
}

export function effectiveNetworkScopeEnabled(config: AuthSecurityConfig, networkFingerprint: string | null): boolean {
  return config.enableNetworkScope && Boolean(networkFingerprint);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('Configuracao numerica de autenticacao invalida.');
  }
  return parsed;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() !== 'false';
}
