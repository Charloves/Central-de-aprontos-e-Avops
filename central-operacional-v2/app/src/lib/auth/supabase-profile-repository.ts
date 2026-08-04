import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeTrigram } from '@/lib/domain/normalization';
import type { Role } from '@/lib/domain/types';
import { createServerSupabaseClient } from '@/lib/db/client';
import type { AuthProfile, ProfileRepository } from './profiles';

type ProfileRow = {
  id: string;
  trigram: string;
  name: string;
  active: boolean;
  profile_roles: Array<{ role: Role }> | null;
};

export class SupabaseProfileRepository implements ProfileRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async findByTrigram(trigram: string): Promise<AuthProfile | null> {
    const normalized = normalizeTrigram(trigram);
    if (!normalized) return null;

    const { data, error } = await this.client
      .from('profiles')
      .select('id,trigram,name,active,profile_roles!profile_roles_profile_id_fkey(role)')
      .eq('trigram', normalized)
      .maybeSingle<ProfileRow>();

    if (error) throw error;
    if (!data) return null;

    return {
      id: data.id,
      trigram: data.trigram,
      name: data.name,
      active: data.active,
      roles: normalizeRoles(data.profile_roles?.map((row) => row.role) ?? []),
    };
  }
}

function normalizeRoles(roles: Role[]): Role[] {
  const unique = new Set<Role>(roles);
  unique.add('USER');
  return Array.from(unique);
}
