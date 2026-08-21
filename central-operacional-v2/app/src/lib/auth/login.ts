import { normalizeTrigram } from '@/lib/domain/normalization';
import {
  buildSessionCookieOptions,
  createSessionTokenWithPayload,
  getSessionDurationSeconds,
  validateSessionSecret,
  type SessionCookieOptions,
} from './session';
import type { LoginAuditContract, ProfileRepository } from './profiles';
import { getSessionHashes, type AuthSecurityConfig, type AuthSecurityContext, type AuthSecurityRepository } from './security';

export const GENERIC_LOGIN_FAILURE = 'Não foi possível iniciar a sessão. Confira o trigrama e tente novamente.';

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
  securityRepository?: AuthSecurityRepository;
  securityConfig?: AuthSecurityConfig;
  securityContext?: AuthSecurityContext;
  durationSeconds?: number;
  environment?: string;
  now?: Date;
}): Promise<LoginResult> {
  const occurredAt = (input.now ?? new Date()).toISOString();
  const normalized = typeof input.rawTrigram === 'string' ? normalizeTrigram(input.rawTrigram) : '';
  const secret = validateSessionSecret(input.secret);

  if (!isAllowedTrigramFormat(normalized)) {
    if (secret.ok && hasSecurity(input)) {
      try {
        await input.securityRepository.recordLoginFailure({
          context: input.securityContext,
          config: input.securityConfig,
          reason: 'INVALID_FORMAT',
          now: input.now,
        });
      } catch {
        return {
          ok: false,
          message: GENERIC_LOGIN_FAILURE,
          status: 401,
          audit: buildAudit('NEGADO', 'SECURITY_ERROR', null, occurredAt),
        };
      }
      return failure(401, 'INVALID_FORMAT', null, occurredAt);
    }
    return failure(400, 'INVALID_FORMAT', normalized || null, occurredAt);
  }

  if (!secret.ok) {
    return {
      ok: false,
      message: 'Configuração de sessão indisponível.',
      status: 500,
      audit: buildAudit('NEGADO', 'CONFIG_ERROR', normalized, occurredAt),
    };
  }

  try {
    if (hasSecurity(input)) {
      const block = await input.securityRepository.checkTemporaryBlock({
        context: input.securityContext,
        config: input.securityConfig,
        now: input.now,
      });
      if (block.blocked) {
        await input.securityRepository.recordAuditEvent({
          eventType: 'LOGIN_BLOCKED',
          result: 'NEGADO',
          context: input.securityContext,
          reason: 'TEMPORARY_BLOCK',
          now: input.now,
        });
        return failure(401, 'BLOCKED', normalized, occurredAt);
      }
    }

    const profile = await input.repository.findByTrigram(normalized);
    if (!profile || !profile.active) {
      if (hasSecurity(input)) {
        await input.securityRepository.recordLoginFailure({
          context: input.securityContext,
          config: input.securityConfig,
          reason: profile ? 'INACTIVE' : 'INVALID_CREDENTIALS',
          now: input.now,
        });
      }
      return failure(401, profile ? 'INACTIVE' : 'INVALID_CREDENTIALS', normalized, occurredAt);
    }

    const durationSeconds = input.durationSeconds ?? getSessionDurationSeconds();
    const session = createSessionTokenWithPayload({
      secret: secret.secret,
      durationSeconds,
    });

    if (hasSecurity(input)) {
      const hashes = getSessionHashes(session.payload, input.securityConfig.fingerprintSecret);
      await input.securityRepository.recordLoginSuccess({
        context: input.securityContext,
        config: input.securityConfig,
        profile,
        sessionExpiresAt: session.expiresAt,
        sessionIdentifierHash: hashes.sessionIdentifierHash,
        nonceHash: hashes.nonceHash,
        now: input.now,
      });
    }

    return {
      ok: true,
      token: session.token,
      cookie: buildSessionCookieOptions({
        durationSeconds,
        environment: input.environment ?? process.env.NODE_ENV,
      }),
      redirectTo: '/portal',
      audit: buildAudit('OK', 'VALID', normalized, occurredAt),
    };
  } catch {
    return {
      ok: false,
      message: GENERIC_LOGIN_FAILURE,
      status: 401,
      audit: buildAudit('NEGADO', 'SECURITY_ERROR', normalized, occurredAt),
    };
  }
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
  _trigram: string | null,
  occurredAt: string,
): LoginAuditContract {
  return {
    action: 'LOGIN',
    status,
    reason,
    trigramHash: null,
    occurredAt,
  };
}

function hasSecurity(input: {
  securityRepository?: AuthSecurityRepository;
  securityConfig?: AuthSecurityConfig;
  securityContext?: AuthSecurityContext;
}): input is {
  securityRepository: AuthSecurityRepository;
  securityConfig: AuthSecurityConfig;
  securityContext: AuthSecurityContext;
} {
  return Boolean(input.securityRepository && input.securityConfig && input.securityContext);
}
