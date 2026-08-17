import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import type {
  AdminAudience,
  AdminAvopDraft,
  AdminBriefingDraft,
  AdminPublicationPayload,
  AdminPublicationRepository,
  AdminPublicationResult,
  AdminPublicationSnapshot,
  PublicationAudienceCode,
} from './publications';

type AudienceRow = {
  id: string;
  code: PublicationAudienceCode;
  name: string;
};

type AvopAdminRow = {
  id: string;
  number: string;
  title: string;
  publication_date: string;
  drive_url: string;
  drive_file_id: string | null;
  status: AdminAvopDraft['status'];
  requires_acknowledgement: boolean;
  avop_audiences: Array<{ audiences: { code: PublicationAudienceCode; name: string; active: boolean } | null }> | null;
  avop_publication_snapshots: Array<{ id: string; published_at: string; applicable_profile_count: number }> | null;
};

type BriefingAdminRow = {
  id: string;
  legacy_id: string | null;
  title: string;
  event_date: string;
  drive_url: string | null;
  drive_file_id: string | null;
  status: AdminBriefingDraft['status'];
  requires_material_acknowledgement: boolean;
  briefing_audiences: Array<{ audiences: { code: PublicationAudienceCode; name: string; active: boolean } | null }> | null;
  briefing_publication_snapshots: Array<{ id: string; opened_at: string; applicable_profile_count: number }> | null;
};

export class SupabasePublicationRepository implements AdminPublicationRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async listAudiences(): Promise<AdminAudience[]> {
    const { data, error } = await this.client
      .from('audiences')
      .select('id,code,name')
      .eq('active', true)
      .order('code', { ascending: true })
      .returns<AudienceRow[]>();
    if (error) throw error;
    return data ?? [];
  }

  async listAvops(): Promise<AdminAvopDraft[]> {
    const { data, error } = await this.client
      .from('avops')
      .select('id,number,title,publication_date,drive_url,drive_file_id,status,requires_acknowledgement,avop_audiences(audiences(code,name,active)),avop_publication_snapshots(id,published_at,applicable_profile_count)')
      .order('created_at', { ascending: false })
      .returns<AvopAdminRow[]>();
    if (error) throw error;
    return (data ?? []).map(mapAvop);
  }

  async findAvop(id: string): Promise<AdminAvopDraft | null> {
    const { data, error } = await this.client
      .from('avops')
      .select('id,number,title,publication_date,drive_url,drive_file_id,status,requires_acknowledgement,avop_audiences(audiences(code,name,active)),avop_publication_snapshots(id,published_at,applicable_profile_count)')
      .eq('id', id)
      .maybeSingle<AvopAdminRow>();
    if (error) throw error;
    return data ? mapAvop(data) : null;
  }

  async saveAvopDraft(input: {
    actorProfileId: string;
    draftId: string | null;
    payload: AdminPublicationPayload;
    now?: Date;
  }): Promise<AdminPublicationResult> {
    return this.callPublicationRpc('admin_save_avop_draft', {
      p_actor_profile_id: input.actorProfileId,
      p_draft_id: input.draftId,
      p_payload: input.payload,
      p_now: input.now?.toISOString(),
    });
  }

  async publishAvop(input: {
    actorProfileId: string;
    avopId: string;
    now?: Date;
  }): Promise<AdminPublicationResult> {
    return this.callPublicationRpc('admin_publish_avop', {
      p_actor_profile_id: input.actorProfileId,
      p_avop_id: input.avopId,
      p_now: input.now?.toISOString(),
    });
  }

  async listBriefings(): Promise<AdminBriefingDraft[]> {
    const { data, error } = await this.client
      .from('briefings')
      .select('id,legacy_id,title,event_date,drive_url,drive_file_id,status,requires_material_acknowledgement,briefing_audiences(audiences(code,name,active)),briefing_publication_snapshots(id,opened_at,applicable_profile_count)')
      .order('created_at', { ascending: false })
      .returns<BriefingAdminRow[]>();
    if (error) throw error;
    return (data ?? []).map(mapBriefing);
  }

  async findBriefing(id: string): Promise<AdminBriefingDraft | null> {
    const { data, error } = await this.client
      .from('briefings')
      .select('id,legacy_id,title,event_date,drive_url,drive_file_id,status,requires_material_acknowledgement,briefing_audiences(audiences(code,name,active)),briefing_publication_snapshots(id,opened_at,applicable_profile_count)')
      .eq('id', id)
      .maybeSingle<BriefingAdminRow>();
    if (error) throw error;
    return data ? mapBriefing(data) : null;
  }

  async saveBriefingDraft(input: {
    actorProfileId: string;
    draftId: string | null;
    payload: AdminPublicationPayload;
    now?: Date;
  }): Promise<AdminPublicationResult> {
    return this.callPublicationRpc('admin_save_briefing_draft', {
      p_actor_profile_id: input.actorProfileId,
      p_draft_id: input.draftId,
      p_payload: input.payload,
      p_now: input.now?.toISOString(),
    });
  }

  async publishBriefing(input: {
    actorProfileId: string;
    briefingId: string;
    now?: Date;
  }): Promise<AdminPublicationResult> {
    return this.callPublicationRpc('admin_publish_briefing', {
      p_actor_profile_id: input.actorProfileId,
      p_briefing_id: input.briefingId,
      p_now: input.now?.toISOString(),
    });
  }

  private async callPublicationRpc(functionName: string, args: Record<string, unknown>): Promise<AdminPublicationResult> {
    const { data, error } = await this.client.rpc(functionName, args);
    if (error) return mapRpcError(error);
    const result = data as Record<string, unknown>;
    return {
      ok: true,
      id: String(result.id),
      snapshotId: typeof result.snapshot_id === 'string' ? result.snapshot_id : undefined,
      applicableProfileCount: typeof result.applicable_profile_count === 'number' ? result.applicable_profile_count : undefined,
      alreadyPublished: result.already_published === true,
    };
  }
}

function mapAvop(row: AvopAdminRow): AdminAvopDraft {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    publicationDate: row.publication_date,
    driveUrl: row.drive_url,
    driveFileId: row.drive_file_id,
    status: row.status,
    requiresAcknowledgement: row.requires_acknowledgement,
    audiences: mapAudiences(row.avop_audiences),
    snapshot: mapSnapshot(row.avop_publication_snapshots, 'published_at'),
  };
}

function mapBriefing(row: BriefingAdminRow): AdminBriefingDraft {
  return {
    id: row.id,
    legacyId: row.legacy_id ?? row.id,
    title: row.title,
    eventDate: row.event_date,
    driveUrl: row.drive_url ?? '',
    driveFileId: row.drive_file_id,
    status: row.status,
    requiresMaterialAcknowledgement: row.requires_material_acknowledgement,
    audiences: mapAudiences(row.briefing_audiences),
    snapshot: mapSnapshot(row.briefing_publication_snapshots, 'opened_at'),
  };
}

function mapAudiences(rows: Array<{ audiences: { code: PublicationAudienceCode; active: boolean } | null }> | null): PublicationAudienceCode[] {
  return (rows ?? [])
    .map((row) => row.audiences)
    .filter((audience): audience is { code: PublicationAudienceCode; active: boolean } => Boolean(audience?.active))
    .map((audience) => audience.code);
}

function mapSnapshot(
  rows: Array<{ id: string; applicable_profile_count: number } & Record<string, string | number>> | null,
  dateField: 'published_at' | 'opened_at',
): AdminPublicationSnapshot | null {
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: row.id,
    publishedAt: String(row[dateField]),
    applicableProfileCount: row.applicable_profile_count,
  };
}

function mapRpcError(error: { code?: string; message?: string }): AdminPublicationResult {
  if (error.code === '42501') return { ok: false, reason: 'NOT_EDITABLE' };
  if (error.code === '22023') {
    if (error.message?.includes('audience')) return { ok: false, reason: 'NO_AUDIENCE' };
    if (error.message?.includes('applicable')) return { ok: false, reason: 'NO_APPLICABLE_PROFILES' };
    return { ok: false, reason: 'INVALID_INPUT' };
  }
  return { ok: false, reason: 'INTERNAL_ERROR' };
}
