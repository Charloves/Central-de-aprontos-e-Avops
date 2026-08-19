import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Role } from '@/lib/domain/types';

export const SESSION_COOKIE_NAME = 'central_operacional_session';

const SessionPayloadSchema = z.object({
  sessionIdentifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
});

export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

export type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: '/';
  maxAge: number;
};

export function createSessionToken(input: {
  secret: string;
  durationSeconds: number;
}): string {
  return createSessionTokenWithPayload(input).token;
}

export function createSessionTokenWithPayload(input: {
  secret: string;
  durationSeconds: number;
}): { token: string; payload: SessionPayload; expiresAt: string } {
  assertStrongSessionSecret(input.secret);
  if (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error('SESSION_DURATION_SECONDS deve ser um inteiro positivo.');
  }
  const sessionIdentifier = randomBytes(32).toString('base64url');
  const payload: SessionPayload = {
    sessionIdentifier,
  };
  return {
    token: sessionIdentifier,
    payload,
    expiresAt: new Date(Date.now() + input.durationSeconds * 1000).toISOString(),
  };
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  assertStrongSessionSecret(secret);
  const parsed = SessionPayloadSchema.safeParse({ sessionIdentifier: token });
  if (!parsed.success) return null;
  return parsed.data;
}

export function validateSessionSecret(secret: string | undefined): { ok: true; secret: string } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: 'SESSION_SECRET ausente.' };
  if (secret.length < 32) return { ok: false, reason: 'SESSION_SECRET deve ter pelo menos 32 caracteres.' };
  if (/^(.)\1+$/.test(secret)) return { ok: false, reason: 'SESSION_SECRET fraco.' };
  return { ok: true, secret };
}

export function assertStrongSessionSecret(secret: string | undefined): asserts secret is string {
  const validation = validateSessionSecret(secret);
  if (!validation.ok) throw new Error(validation.reason);
}

export function getSessionDurationSeconds(value = process.env.SESSION_DURATION_SECONDS): number {
  const parsed = Number(value || 60 * 60 * 8);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 60 * 60 * 24 * 30) {
    throw new Error('SESSION_DURATION_SECONDS invalido.');
  }
  return parsed;
}

export function buildSessionCookieOptions(input: {
  durationSeconds: number;
  environment?: string;
}): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: input.environment === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: input.durationSeconds,
  };
}

export function buildLogoutCookieOptions(environment = process.env.NODE_ENV): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: environment === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
}

export function hasAdminAccess(session: ({ roles?: Role[] } & Partial<SessionPayload>) | null): boolean {
  return hasAdminRole(session?.roles ?? []);
}

export function hasAdminRole(roles: Role[]): boolean {
  return roles.includes('ADMIN') || roles.includes('COORDINATOR');
}
