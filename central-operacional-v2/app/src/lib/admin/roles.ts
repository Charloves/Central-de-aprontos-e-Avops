import { normalizeTrigram } from '@/lib/domain/normalization';
import type { Role } from '@/lib/domain/types';
import type { AuthenticatedSession } from '@/lib/auth/authorization';

export type ManagementRoleHolder = {
  profileId: string;
  trigram: string;
  name: string;
  roles: Role[];
};

export type ManagementRoleTransferResult =
  | { ok: true; fromProfileId: string; toProfileId: string; auditId: string }
  | { ok: false; reason: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'INACTIVE' | 'SAME_PROFILE' | 'INTERNAL_ERROR' };

export type ManagementRoleTransferFailureReason = Extract<ManagementRoleTransferResult, { ok: false }>['reason'];

export type ManagementRoleRepository = {
  listManagementRoleHolders(): Promise<ManagementRoleHolder[]>;
  transferManagementRoles(input: {
    actorProfileId: string;
    targetTrigram: string;
    now?: Date;
  }): Promise<ManagementRoleTransferResult>;
};

export const ROLE_TRANSFER_CONFIRMATION = 'TRANSFERIR ADMINISTRACAO';

export function parseRoleTransferForm(formData: FormData): { ok: true; targetTrigram: string } | { ok: false } {
  if (hasClientSuppliedRoleIdentity(formData)) return { ok: false };

  const target = normalizeTrigram(formData.get('targetTrigram'));
  const repeated = normalizeTrigram(formData.get('targetTrigramRepeat'));
  const confirmation = String(formData.get('confirmation') ?? '').trim().toUpperCase();

  if (!isValidRoleTransferTrigram(target)) return { ok: false };
  if (target !== repeated) return { ok: false };
  if (confirmation !== ROLE_TRANSFER_CONFIRMATION) return { ok: false };

  return { ok: true, targetTrigram: target };
}

export async function transferManagementRolesForSession(input: {
  session: AuthenticatedSession;
  formData: FormData;
  repository: ManagementRoleRepository;
  now?: Date;
}): Promise<ManagementRoleTransferResult> {
  if (!input.session.roles.includes('ADMIN')) return { ok: false, reason: 'FORBIDDEN' };

  const parsed = parseRoleTransferForm(input.formData);
  if (!parsed.ok) return { ok: false, reason: 'INVALID_INPUT' };

  if (parsed.targetTrigram === input.session.trigram) return { ok: false, reason: 'SAME_PROFILE' };

  return input.repository.transferManagementRoles({
    actorProfileId: input.session.profileId,
    targetTrigram: parsed.targetTrigram,
    now: input.now,
  });
}

export function isValidRoleTransferTrigram(value: string): boolean {
  return /^[A-Z0-9]{2,10}$/.test(value);
}

export function hasClientSuppliedRoleIdentity(formData: FormData): boolean {
  const forbiddenFields = new Set([
    'profileid',
    'profile_id',
    'actorprofileid',
    'actor_profile_id',
    'assignedby',
    'assigned_by',
    'sessionid',
    'session_id',
    'role',
    'roles',
  ]);
  return Array.from(formData.keys()).some((key) => forbiddenFields.has(key.toLowerCase()));
}
