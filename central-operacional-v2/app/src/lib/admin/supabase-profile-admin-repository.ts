import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import type {
  AdminProfileSaveInput,
  AdminProfileSaveResult,
  AdminProfileSummary,
  ProfileAdminRepository,
} from './profiles';
import type { AudienceCode, Role } from '@/lib/domain/types';

type ProfileRow = {
  id: string;
  trigram: string;
  name: string;
  email: string | null;
  active: boolean;
  profile_roles: Array<{ role: Role }> | null;
  profile_audiences: Array<{ audiences: { code: AudienceCode; active: boolean } | null }> | null;
};

type SaveRpcResult = {
  ok?: boolean;
  profile_id?: string;
  audit_id?: string;
  sessions_revoked?: number;
};

export class SupabaseProfileAdminRepository implements ProfileAdminRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async listProfiles(): Promise<AdminProfileSummary[]> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id,trigram,name,email,active,profile_roles!profile_roles_profile_id_fkey(role),profile_audiences!profile_audiences_profile_id_fkey(audiences!profile_audiences_audience_id_fkey(code,active))')
      .order('name', { ascending: true })
      .returns<ProfileRow[]>();

    if (error) throw error;

    return (data ?? []).map((profile) => ({
      profileId: profile.id,
      trigram: profile.trigram,
      name: profile.name,
      email: profile.email,
      active: profile.active,
      roles: normalizeRoles(profile.profile_roles?.map((role) => role.role) ?? []),
      audiences: normalizeAudiences(profile.profile_audiences ?? []),
    }));
  }

  async listAudienceCodes(): Promise<string[]> {
    const { data, error } = await this.client
      .from('audiences')
      .select('code')
      .eq('active', true)
      .order('code', { ascending: true })
      .returns<Array<{ code: string }>>();

    if (error) throw error;
    return (data ?? []).map((row) => row.code);
  }

  async saveProfile(input: AdminProfileSaveInput): Promise<AdminProfileSaveResult> {
    const { data, error } = await this.client.rpc('admin_save_profile', {
      p_actor_profile_id: input.actorProfileId,
      p_profile_id: input.targetProfileId,
      p_payload: input.payload,
      p_now: (input.now ?? new Date()).toISOString(),
    });

    if (error) return { ok: false, reason: mapSaveError(error.code) };

    const result = data as SaveRpcResult | null;
    if (!result?.ok || !result.profile_id || !result.audit_id) {
      return { ok: false, reason: 'INTERNAL_ERROR' };
    }

    return {
      ok: true,
      profileId: result.profile_id,
      auditId: result.audit_id,
      sessionsRevoked: result.sessions_revoked ?? 0,
    };
  }
}

function normalizeRoles(roles: Role[]): Role[] {
  const order: Role[] = ['USER', 'COORDINATOR', 'ADMIN'];
  const unique = new Set(roles);
  return order.filter((role) => unique.has(role));
}

function normalizeAudiences(rows: Array<{ audiences: { code: AudienceCode; active: boolean } | null }>): AudienceCode[] {
  return rows
    .map((row) => row.audiences)
    .filter((audience): audience is { code: AudienceCode; active: boolean } => Boolean(audience?.active))
    .map((audience) => audience.code)
    .sort();
}

function mapSaveError(code: string | undefined): Extract<AdminProfileSaveResult, { ok: false }>['reason'] {
  if (code === '42501') return 'FORBIDDEN';
  if (code === '22023') return 'INVALID_INPUT';
  if (code === '02000') return 'NOT_FOUND';
  if (code === '23505') return 'CONFLICT';
  return 'INTERNAL_ERROR';
}
