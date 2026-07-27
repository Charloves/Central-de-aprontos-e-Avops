import { createHash } from 'node:crypto';
import { normalizeTrigram } from '@/lib/domain/normalization';
import {
  buildSessionCookieOptions,
  createSessionToken,
  getSessionDurationSeconds,
  validateSessionSecret,
  type SessionCookieOptions,
} from './session';
import type { LoginAuditContract, ProfileRepository } from './profiles';

export const GENERIC_LOGIN_FAILURE = 'Nao foi possivel iniciar a sessao. Confira o trigrama e tente novamente.';

export type LoginResult =
  | {
      ok: true;
      token: string;
      cookie: SessionCookieOptions;
      redirectTo: '/portal';
      audit: LoginAuditContract;
    }
  | {
      ok: false;
      message: string;
      status: 400 | 401 | 500;
      audit: LoginAuditContract;
    };

export async function authenticateTrigram(input: {
  rawTrigram: unknown;
  repository: ProfileRepository;
  secret: string | undefined;
  durationSeconds?: number;
  environment?: string;
  now?: Date;
}): Promise<LoginResult> {
  const occurredAt = (input.now ?? new Date()).toISOString();
  const normalized = typeof input.rawTrigram === 'string' ? normalizeTrigram(input.rawTrigram) : '';
  const secret = validateSessionSecret(input.secret);

  if (!isAllowedTrigramFormat(normalized)) {
    return failure(400, 'INVALID_FORMAT', normalized || null, occurredAt);
  }

  if (!secret.ok) {
    return {
      ok: false,
      message: 'Configuracao de sessao indisponivel.',
      status: 500,
      audit: buildAudit('NEGADO', 'CONFIG_ERROR', normalized, occurredAt),
    };
  }

  const profile = await input.repository.findByTrigram(normalized);
  if (!profile || !profile.active) {
    return failure(401, profile ? 'INACTIVE' : 'INVALID_CREDENTIALS', normalized, occurredAt);
  }

  const durationSeconds = input.durationSeconds ?? getSessionDurationSeconds();
  return {
    ok: true,
    token: createSessionToken({
      trigram: profile.trigram,
      secret: secret.secret,
      durationSeconds,
    }),
    cookie: buildSessionCookieOptions({
      durationSeconds,
      environment: input.environment ?? process.env.NODE_ENV,
    }),
    redirectTo: '/portal',
    audit: buildAudit('OK', 'VALID', normalized, occurredAt),
  };
}

export function isAllowedTrigramFormat(trigram: string): boolean {
  return /^[A-Z0-9]{2,8}$/.test(trigram);
}

function failure(
  status: 400 | 401,
  reason: LoginAuditContract['reason'],
  trigram: string | null,
  occurredAt: string,
): LoginResult {
  return {
    ok: false,
    message: GENERIC_LOGIN_FAILURE,
    status,
    audit: buildAudit('NEGADO', reason, trigram, occurredAt),
  };
}

function buildAudit(
  status: LoginAuditContract['status'],
  reason: LoginAuditContract['reason'],
  trigram: string | null,
  occurredAt: string,
): LoginAuditContract {
  return {
    action: 'LOGIN',
    status,
    reason,
    trigramHash: trigram ? createHash('sha256').update(trigram).digest('hex') : null,
    occurredAt,
  };
}
