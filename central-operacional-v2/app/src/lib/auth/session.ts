import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { normalizeTrigram } from '@/lib/domain/normalization';
import type { Role } from '@/lib/domain/types';

export const SESSION_COOKIE_NAME = 'central_operacional_session';

const SessionPayloadSchema = z.object({
  trigram: z.string(),
  exp: z.number(),
  nonce: z.string(),
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
  trigram: string;
  secret: string;
  durationSeconds: number;
}): string {
  assertStrongSessionSecret(input.secret);
  if (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error('SESSION_DURATION_SECONDS deve ser um inteiro positivo.');
  }
  const payload: SessionPayload = {
    trigram: normalizeTrigram(input.trigram),
    exp: Date.now() + input.durationSeconds * 1000,
    nonce: randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded, input.secret)}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  assertStrongSessionSecret(secret);
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  if (!safeEqual(signature, expected)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const parsed = SessionPayloadSchema.safeParse(decoded);
  if (!parsed.success) return null;
  if (Date.now() > parsed.data.exp) return null;
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

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
