import type { AdminProfileSaveInput, AdminProfileSaveResult, AdminProfileSummary, ProfileAdminRepository } from './profiles';
import type { Role } from '@/lib/domain/types';

export class FakeProfileAdminRepository implements ProfileAdminRepository {
  private profiles = new Map<string, AdminProfileSummary>();
  private audiences = new Set<string>(['PILOTO', 'TRIPULANTE', 'HSAR', 'TODOS']);
  public revokedProfileIds: string[] = [];
  public auditActions: Array<{ action: string; profileId: string; actorProfileId: string }> = [];

  constructor(input: { profiles?: AdminProfileSummary[]; audienceCodes?: string[] } = {}) {
    for (const profile of input.profiles ?? []) this.profiles.set(profile.profileId, cloneProfile(profile));
    for (const code of input.audienceCodes ?? []) this.audiences.add(code);
  }

  async listProfiles(): Promise<AdminProfileSummary[]> {
    return [...this.profiles.values()].map(cloneProfile).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async listAudienceCodes(): Promise<string[]> {
    return [...this.audiences].sort();
  }

  async saveProfile(input: AdminProfileSaveInput): Promise<AdminProfileSaveResult> {
    if (!this.isActiveAdmin(input.actorProfileId)) return { ok: false, reason: 'FORBIDDEN' };
    if (input.payload.audienceCodes.some((code) => !this.audiences.has(code))) return { ok: false, reason: 'INVALID_INPUT' };

    const target = input.targetProfileId ? this.profiles.get(input.targetProfileId) : null;
    if (input.targetProfileId && !target) return { ok: false, reason: 'NOT_FOUND' };

    if (target?.roles.includes('ADMIN') && !input.payload.active && this.countActiveAdminsExcept(target.profileId) === 0) {
      return { ok: false, reason: 'FORBIDDEN' };
    }

    const duplicate = [...this.profiles.values()].find((profile) => (
      profile.trigram === input.payload.trigram && profile.profileId !== input.targetProfileId
    ));
    if (duplicate) return { ok: false, reason: 'CONFLICT' };

    const profileId = input.targetProfileId ?? `profile-${this.profiles.size + 1}`;
    const old = this.profiles.get(profileId);
    const preservedAdmin = old?.roles.includes('ADMIN') ? ['ADMIN' as Role] : [];
    const roles = normalizeRoles([...input.payload.roles, ...preservedAdmin]);

    this.profiles.set(profileId, {
      profileId,
      trigram: input.payload.trigram,
      name: input.payload.name,
      email: input.payload.email,
      active: input.payload.active,
      roles,
      audiences: [...input.payload.audienceCodes].sort(),
    });

    if (old && (!input.payload.active || roles.join('|') !== old.roles.join('|'))) {
      this.revokedProfileIds.push(profileId);
    }

    this.auditActions.push({
      action: old ? 'PROFILE_UPDATED' : 'PROFILE_CREATED',
      profileId,
      actorProfileId: input.actorProfileId,
    });

    return { ok: true, profileId, auditId: `audit-${this.auditActions.length}`, sessionsRevoked: this.revokedProfileIds.length };
  }

  private isActiveAdmin(profileId: string) {
    const profile = this.profiles.get(profileId);
    return Boolean(profile?.active && profile.roles.includes('ADMIN'));
  }

  private countActiveAdminsExcept(profileId: string) {
    return [...this.profiles.values()].filter((profile) => (
      profile.profileId !== profileId && profile.active && profile.roles.includes('ADMIN')
    )).length;
  }
}

function cloneProfile(profile: AdminProfileSummary): AdminProfileSummary {
  return {
    ...profile,
    roles: [...profile.roles],
    audiences: [...profile.audiences],
  };
}

function normalizeRoles(roles: Role[]): Role[] {
  const order: Role[] = ['USER', 'COORDINATOR', 'ADMIN'];
  const unique = new Set(roles);
  return order.filter((role) => unique.has(role));
}
