import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { normalizeTrigram } from '@/lib/domain/normalization';
import type { Role } from '@/lib/domain/types';

const SessionPayloadSchema = z.object({
  trigram: z.string(),
  roles: z.array(z.enum(['USER', 'COORDINATOR', 'ADMIN'])),
  exp: z.number(),
  nonce: z.string(),
});

export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

export function createSessionToken(input: {
  trigram: string;
  roles: Role[];
  secret: string;
  durationSeconds: number;
}): string {
  const payload: SessionPayload = {
    trigram: normalizeTrigram(input.trigram),
    roles: input.roles,
    exp: Date.now() + input.durationSeconds * 1000,
    nonce: randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded, input.secret)}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  if (!safeEqual(signature, expected)) return null;

  const parsed = SessionPayloadSchema.safeParse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  if (!parsed.success) return null;
  if (Date.now() > parsed.data.exp) return null;
  return parsed.data;
}

export function hasAdminAccess(session: SessionPayload | null): boolean {
  return Boolean(session?.roles.includes('ADMIN') || session?.roles.includes('COORDINATOR'));
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
