import { describe, expect, it, vi } from 'vitest';
import { SupabaseAuthSecurityRepository } from './supabase-security-repository';
import type { AuthSecurityConfig, AuthSecurityContext } from './security';

vi.mock('server-only', () => ({}));

const config: AuthSecurityConfig = {
  fingerprintSecret: 'auth-secret-0123456789abcdef012345',
  maxAttempts: 5,
  windowSeconds: 900,
  blockSeconds: 900,
  sessionTouchIntervalSeconds: 300,
  enableTrigramScope: true,
  enableNetworkScope: true,
};

const context: AuthSecurityContext = {
  trigramFingerprint: 'a'.repeat(64),
  networkFingerprint: 'b'.repeat(64),
  userAgentFingerprint: 'c'.repeat(64),
};

describe('SupabaseAuthSecurityRepository', () => {
  it('envia p_now explicito para as RPCs mesmo sem now injetado', async () => {
    const rpc = vi.fn((name: string, _args: Record<string, unknown>) => {
      void _args;
      if (name === 'auth_check_temporary_block') return { data: [{ blocked: false, blocked_until: null, scope: null }], error: null };
      if (name === 'auth_finalize_login_failure') return { data: [{ blocked: false, blocked_until: null }], error: null };
      if (name === 'auth_finalize_login_success') return { data: [{ session_id: 'session-id', blocked: false, blocked_until: null }], error: null };
      if (name === 'auth_revoke_profile_sessions') return { data: 1, error: null };
      if (name === 'auth_record_audit_event') return { data: 'event-id', error: null };
      return { data: null, error: null };
    });
    const sessionRow = {
      id: 'session-id',
      profile_id: 'profile-id',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
      last_seen_at: null,
    };
    const from = vi.fn((table: string) => {
      if (table !== 'auth_sessions') throw new Error('tabela inesperada');
      const selectMaybeSingle = vi.fn().mockResolvedValue({ data: sessionRow, error: null });
      const selectEq = vi.fn().mockReturnValue({ maybeSingle: selectMaybeSingle });
      const select = vi.fn().mockReturnValue({ eq: selectEq });
      const updateSelectMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'session-id', profile_id: 'profile-id', expires_at: sessionRow.expires_at, revoked_at: null },
        error: null,
      });
      const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateSelectMaybeSingle });
      const gt = vi.fn().mockReturnValue({ select: updateSelect });
      const is = vi.fn().mockReturnValue({ gt, select: updateSelect });
      const updateEq = vi.fn().mockReturnValue({ is });
      const update = vi.fn().mockReturnValue({ eq: updateEq });
      return { select, update };
    });
    const repository = new SupabaseAuthSecurityRepository({ rpc, from } as never);

    await repository.checkTemporaryBlock({ context, config });
    await repository.recordLoginFailure({ context, config, reason: 'INVALID_CREDENTIALS' });
    await repository.recordLoginSuccess({
      context,
      config,
      profile: { id: 'profile-id', trigram: 'CHA', name: 'Usuario Ficticio', active: true, roles: ['USER'] },
      sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionIdentifierHash: 'd'.repeat(64),
      nonceHash: 'e'.repeat(64),
    });
    await repository.touchSession({ sessionIdentifierHash: 'd'.repeat(64), touchIntervalSeconds: 300 });
    await repository.revokeSession({ sessionIdentifierHash: 'd'.repeat(64), reason: 'LOGOUT' });
    await repository.revokeProfileSessions({ profileId: 'profile-id', reason: 'ADMIN_REVOCATION' });
    await repository.recordAuditEvent({ eventType: 'LOGOUT', result: 'OK', context });

    for (const call of rpc.mock.calls) {
      const args = call[1];
      expect(args.p_now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(args.p_now).not.toBeUndefined();
      expect(args.p_now).not.toBeNull();
    }
  });
});
