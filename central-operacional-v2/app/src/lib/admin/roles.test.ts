import { describe, expect, it } from 'vitest';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import type { ManagementRoleRepository, ManagementRoleTransferResult } from './roles';
import {
  ROLE_TRANSFER_CONFIRMATION,
  parseRoleTransferForm,
  transferManagementRolesForSession,
} from './roles';

const adminSession: AuthenticatedSession = {
  sessionIdentifier: 'opaque-session',
  profileId: 'profile-cha',
  trigram: 'CHA',
  roles: ['USER', 'ADMIN', 'COORDINATOR'],
  persistentSessionId: 'session-id',
};

describe('management role transfer', () => {
  it('aceita somente trigrama repetido e confirmação textual inequívoca', () => {
    const form = roleTransferForm('usr');

    expect(parseRoleTransferForm(form)).toEqual({ ok: true, targetTrigram: 'USR' });
  });

  it('rejeita input inválido, excessivo ou divergente', () => {
    expect(parseRoleTransferForm(roleTransferForm('U'))).toEqual({ ok: false });
    expect(parseRoleTransferForm(roleTransferForm('USR', 'TRP'))).toEqual({ ok: false });
    expect(parseRoleTransferForm(roleTransferForm('USR', 'USR', 'CONFIRMO'))).toEqual({ ok: false });
    expect(parseRoleTransferForm(roleTransferForm('USUARIO-LONGO'))).toEqual({ ok: false });
  });

  it('rejeita identidade ou papéis enviados pelo navegador', () => {
    for (const field of ['profile_id', 'actor_profile_id', 'assigned_by', 'session_id', 'roles']) {
      const form = roleTransferForm('USR');
      form.set(field, 'malicious');
      expect(parseRoleTransferForm(form)).toEqual({ ok: false });
    }
  });

  it('usa exclusivamente a identidade da sessão para transferir', async () => {
    const repository = new FakeManagementRoleRepository();
    const result = await transferManagementRolesForSession({
      session: adminSession,
      formData: roleTransferForm('USR'),
      repository,
      now: new Date('2026-08-11T12:00:00.000Z'),
    });

    expect(result).toMatchObject({ ok: true, fromProfileId: 'profile-cha', toProfileId: 'profile-usr' });
    expect(repository.calls).toEqual([
      {
        actorProfileId: 'profile-cha',
        targetTrigram: 'USR',
        now: new Date('2026-08-11T12:00:00.000Z'),
      },
    ]);
  });

  it('bloqueia COORDINATOR sem ADMIN e USER comum antes da RPC', async () => {
    const repository = new FakeManagementRoleRepository();

    await expect(transferManagementRolesForSession({
      session: { ...adminSession, roles: ['USER', 'COORDINATOR'] },
      formData: roleTransferForm('USR'),
      repository,
    })).resolves.toEqual({ ok: false, reason: 'FORBIDDEN' });

    await expect(transferManagementRolesForSession({
      session: { ...adminSession, roles: ['USER'] },
      formData: roleTransferForm('USR'),
      repository,
    })).resolves.toEqual({ ok: false, reason: 'FORBIDDEN' });
    expect(repository.calls).toHaveLength(0);
  });

  it('bloqueia destino igual à origem antes da RPC', async () => {
    const repository = new FakeManagementRoleRepository();

    await expect(transferManagementRolesForSession({
      session: adminSession,
      formData: roleTransferForm('CHA'),
      repository,
    })).resolves.toEqual({ ok: false, reason: 'SAME_PROFILE' });
    expect(repository.calls).toHaveLength(0);
  });

  it('propaga falha segura do repositório sem expor detalhes', async () => {
    const repository = new FakeManagementRoleRepository({ ok: false, reason: 'INTERNAL_ERROR' });

    await expect(transferManagementRolesForSession({
      session: adminSession,
      formData: roleTransferForm('USR'),
      repository,
    })).resolves.toEqual({ ok: false, reason: 'INTERNAL_ERROR' });
  });
});

function roleTransferForm(
  targetTrigram: string,
  repeat = targetTrigram,
  confirmation = ROLE_TRANSFER_CONFIRMATION,
): FormData {
  const form = new FormData();
  form.set('targetTrigram', targetTrigram);
  form.set('targetTrigramRepeat', repeat);
  form.set('confirmation', confirmation);
  return form;
}

class FakeManagementRoleRepository implements ManagementRoleRepository {
  readonly calls: Array<{ actorProfileId: string; targetTrigram: string; now?: Date }> = [];

  constructor(private readonly result: ManagementRoleTransferResult = {
    ok: true as const,
    fromProfileId: 'profile-cha',
    toProfileId: 'profile-usr',
    auditId: 'audit-id',
  }) {}

  async listManagementRoleHolders() {
    return [];
  }

  async transferManagementRoles(input: { actorProfileId: string; targetTrigram: string; now?: Date }) {
    this.calls.push(input);
    return this.result;
  }
}
