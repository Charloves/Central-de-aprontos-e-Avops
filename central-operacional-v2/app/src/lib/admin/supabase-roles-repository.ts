import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import type { Role } from '@/lib/domain/types';
import type {
  ManagementRoleHolder,
  ManagementRoleRepository,
  ManagementRoleTransferFailureReason,
  ManagementRoleTransferResult,
} from './roles';

type RoleRow = {
  role: Role;
  profiles: {
    id: string;
    trigram: string;
    name: string;
    active: boolean;
    profile_roles: Array<{ role: Role }> | null;
  } | null;
};

type TransferRpcResult = {
  ok?: boolean;
  from_profile_id?: string;
  to_profile_id?: string;
  audit_id?: string;
};

export class SupabaseManagementRoleRepository implements ManagementRoleRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async listManagementRoleHolders(): Promise<ManagementRoleHolder[]> {
    const { data, error } = await this.client
      .from('profile_roles')
      .select('role,profiles!profile_roles_profile_id_fkey(id,trigram,name,active,profile_roles!profile_roles_profile_id_fkey(role))')
      .in('role', ['ADMIN', 'COORDINATOR'])
      .returns<RoleRow[]>();

    if (error) throw error;

    const byProfile = new Map<string, ManagementRoleHolder>();
    for (const row of data ?? []) {
      if (!row.profiles?.active) continue;
      const existing = byProfile.get(row.profiles.id);
      const roles = normalizeRoles(row.profiles.profile_roles?.map((roleRow) => roleRow.role) ?? [row.role]);
      if (!existing) {
        byProfile.set(row.profiles.id, {
          profileId: row.profiles.id,
          trigram: row.profiles.trigram,
          name: row.profiles.name,
          roles,
        });
      } else {
        existing.roles = normalizeRoles([...existing.roles, ...roles]);
      }
    }

    return [...byProfile.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async transferManagementRoles(input: {
    actorProfileId: string;
    targetTrigram: string;
    now?: Date;
  }): Promise<ManagementRoleTransferResult> {
    const { data, error } = await this.client.rpc('transfer_management_roles', {
      p_actor_profile_id: input.actorProfileId,
      p_target_trigram: input.targetTrigram,
      p_now: (input.now ?? new Date()).toISOString(),
    });

    if (error) return { ok: false, reason: mapTransferError(error.code) };

    const result = data as TransferRpcResult | null;
    if (!result?.ok || !result.from_profile_id || !result.to_profile_id || !result.audit_id) {
      return { ok: false, reason: 'INTERNAL_ERROR' };
    }

    return {
      ok: true,
      fromProfileId: result.from_profile_id,
      toProfileId: result.to_profile_id,
      auditId: result.audit_id,
    };
  }
}

function normalizeRoles(roles: Role[]): Role[] {
  const order: Role[] = ['USER', 'COORDINATOR', 'ADMIN'];
  const unique = new Set(roles);
  return order.filter((role) => unique.has(role));
}

function mapTransferError(code: string | undefined): ManagementRoleTransferFailureReason {
  if (code === '42501') return 'FORBIDDEN';
  if (code === '28000') return 'INACTIVE';
  if (code === '22023') return 'INVALID_INPUT';
  return 'INTERNAL_ERROR';
}
