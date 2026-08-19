import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import { getEffectiveBriefingStatus, isBriefingApplicable } from './rules';
import type {
  AbsenceJustification,
  BriefingListItem,
  BriefingRecord,
  BriefingRepository,
  BriefingStatus,
} from './types';

type AudienceJoinRow = {
  audience_id: string;
  audiences: { code: string; active: boolean } | null;
};

type BriefingRow = {
  id: string;
  legacy_id: string | null;
  title: string;
  event_date: string | null;
  drive_url: string | null;
  status: BriefingStatus;
  requires_material_acknowledgement: boolean;
  briefing_audiences: Array<{ audiences: { code: string; active: boolean } | null }> | null;
};

type BriefingRecordRow = {
  id: string;
  briefing_id: string;
  profile_id: string;
  attendance_status: string;
  material_acknowledged: boolean;
  recorded_at: string;
};

type AbsenceJustificationRow = {
  id: string;
  briefing_id: string;
  profile_id: string;
  text: string;
  created_at: string;
  updated_at: string;
};

export class SupabaseBriefingRepository implements BriefingRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async listApplicableBriefings(profileId: string, now: Date = new Date()): Promise<BriefingListItem[]> {
    const profileAudiences = await this.loadProfileAudiences(profileId, now);
    if (profileAudiences.length === 0) return [];

    const { data, error } = await this.client
      .from('briefings')
      .select('id,legacy_id,title,event_date,drive_url,status,requires_material_acknowledgement,briefing_audiences(audiences(code,active))')
      .neq('status', 'DRAFT')
      .order('event_date', { ascending: false })
      .order('legacy_id', { ascending: true })
      .returns<BriefingRow[]>();
    if (error) throw error;

    const applicable = (data ?? [])
      .map((row) => mapBriefingRow(row, null, null, now))
      .filter((briefing) => isBriefingApplicable(profileAudiences, briefing.audiences));

    const records = await this.loadRecords(profileId, applicable.map((briefing) => briefing.id));
    const justifications = await this.loadLatestJustifications(profileId, applicable.map((briefing) => briefing.id));
    return applicable.map((briefing) => ({
      ...briefing,
      record: records.get(briefing.id) ?? null,
      latestJustification: justifications.get(briefing.id) ?? null,
    }));
  }

  async findApplicableBriefing(profileId: string, briefingId: string, now: Date = new Date()): Promise<BriefingListItem | null> {
    const profileAudiences = await this.loadProfileAudiences(profileId, now);
    if (profileAudiences.length === 0) return null;

    const { data, error } = await this.client
      .from('briefings')
      .select('id,legacy_id,title,event_date,drive_url,status,requires_material_acknowledgement,briefing_audiences(audiences(code,active))')
      .eq('id', briefingId)
      .maybeSingle<BriefingRow>();
    if (error) throw error;
    if (!data) return null;

    const record = await this.loadRecord(profileId, briefingId);
    const justification = await this.loadLatestJustification(profileId, briefingId);
    const briefing = mapBriefingRow(data, record, justification, now);
    if (briefing.status === 'DRAFT') return null;
    if (!isBriefingApplicable(profileAudiences, briefing.audiences)) return null;
    return briefing;
  }

  async acknowledgeMaterial(
    profileId: string,
    briefingId: string,
    now: Date = new Date(),
  ): Promise<BriefingRecord> {
    const existing = await this.loadRecord(profileId, briefingId);
    if (existing?.materialAcknowledged) return existing;
    if (existing) return this.markMaterialAcknowledged(profileId, briefingId);

    const { data, error } = await this.client
      .from('briefing_records')
      .insert({
        briefing_id: briefingId,
        profile_id: profileId,
        attendance_status: 'PENDENTE',
        material_acknowledged: true,
        recorded_at: now.toISOString(),
        legacy_source: {},
      })
      .select('id,briefing_id,profile_id,attendance_status,material_acknowledged,recorded_at')
      .single<BriefingRecordRow>();
    if (!error && data) return mapRecord(data);
    if (isUniqueViolation(error)) {
      const current = await this.loadRecord(profileId, briefingId);
      if (current?.materialAcknowledged) return current;
      if (current) return this.markMaterialAcknowledged(profileId, briefingId);
    }
    throw error ?? new Error('Não foi possível registrar a ciência do material.');
  }

  async createJustification(
    profileId: string,
    briefingId: string,
    text: string,
    now: Date = new Date(),
  ): Promise<AbsenceJustification> {
    const timestamp = now.toISOString();
    const { data, error } = await this.client
      .from('absence_justifications')
      .insert({
        briefing_id: briefingId,
        profile_id: profileId,
        text,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select('id,briefing_id,profile_id,text,created_at,updated_at')
      .single<AbsenceJustificationRow>();
    if (error) throw error;
    return mapJustification(data);
  }

  private async markMaterialAcknowledged(profileId: string, briefingId: string): Promise<BriefingRecord> {
    const { data, error } = await this.client
      .from('briefing_records')
      .update({ material_acknowledged: true })
      .eq('profile_id', profileId)
      .eq('briefing_id', briefingId)
      .select('id,briefing_id,profile_id,attendance_status,material_acknowledged,recorded_at')
      .single<BriefingRecordRow>();
    if (error) throw error;
    return mapRecord(data);
  }

  private async loadProfileAudiences(profileId: string, now: Date): Promise<string[]> {
    const date = now.toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('profile_audiences')
      .select('audience_id,audiences(code,active)')
      .eq('profile_id', profileId)
      .or(`valid_from.is.null,valid_from.lte.${date}`)
      .or(`valid_to.is.null,valid_to.gte.${date}`)
      .returns<AudienceJoinRow[]>();
    if (error) throw error;
    return (data ?? [])
      .map((row) => row.audiences)
      .filter((audience): audience is { code: string; active: boolean } => Boolean(audience?.active))
      .map((audience) => audience.code);
  }

  private async loadRecords(profileId: string, briefingIds: string[]): Promise<Map<string, BriefingRecord>> {
    if (briefingIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('briefing_records')
      .select('id,briefing_id,profile_id,attendance_status,material_acknowledged,recorded_at')
      .eq('profile_id', profileId)
      .in('briefing_id', briefingIds)
      .returns<BriefingRecordRow[]>();
    if (error) throw error;
    return new Map((data ?? []).map((row) => [row.briefing_id, mapRecord(row)]));
  }

  private async loadRecord(profileId: string, briefingId: string): Promise<BriefingRecord | null> {
    const { data, error } = await this.client
      .from('briefing_records')
      .select('id,briefing_id,profile_id,attendance_status,material_acknowledged,recorded_at')
      .eq('profile_id', profileId)
      .eq('briefing_id', briefingId)
      .maybeSingle<BriefingRecordRow>();
    if (error) throw error;
    return data ? mapRecord(data) : null;
  }

  private async loadLatestJustifications(profileId: string, briefingIds: string[]): Promise<Map<string, AbsenceJustification>> {
    if (briefingIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('absence_justifications')
      .select('id,briefing_id,profile_id,text,created_at,updated_at')
      .eq('profile_id', profileId)
      .in('briefing_id', briefingIds)
      .order('created_at', { ascending: false })
      .returns<AbsenceJustificationRow[]>();
    if (error) throw error;
    const latest = new Map<string, AbsenceJustification>();
    for (const row of data ?? []) {
      if (!latest.has(row.briefing_id)) latest.set(row.briefing_id, mapJustification(row));
    }
    return latest;
  }

  private async loadLatestJustification(profileId: string, briefingId: string): Promise<AbsenceJustification | null> {
    const { data, error } = await this.client
      .from('absence_justifications')
      .select('id,briefing_id,profile_id,text,created_at,updated_at')
      .eq('profile_id', profileId)
      .eq('briefing_id', briefingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<AbsenceJustificationRow>();
    if (error) throw error;
    return data ? mapJustification(data) : null;
  }
}

function mapBriefingRow(
  row: BriefingRow,
  record: BriefingRecord | null,
  latestJustification: AbsenceJustification | null,
  now: Date,
): BriefingListItem {
  const briefing = {
    id: row.id,
    legacyId: row.legacy_id ?? row.id,
    title: row.title,
    eventDate: row.event_date,
    status: row.status,
    driveUrl: row.drive_url,
    requiresMaterialAcknowledgement: row.requires_material_acknowledgement,
    audiences: (row.briefing_audiences ?? [])
      .map((join) => join.audiences)
      .filter((audience): audience is { code: string; active: boolean } => Boolean(audience?.active))
      .map((audience) => audience.code),
    record,
    latestJustification,
  };
  return {
    ...briefing,
    effectiveStatus: getEffectiveBriefingStatus(briefing, now),
  };
}

function mapRecord(row: BriefingRecordRow): BriefingRecord {
  return {
    id: row.id,
    briefingId: row.briefing_id,
    profileId: row.profile_id,
    attendanceStatus: row.attendance_status,
    materialAcknowledged: row.material_acknowledged,
    recordedAt: row.recorded_at,
  };
}

function mapJustification(row: AbsenceJustificationRow): AbsenceJustification {
  return {
    id: row.id,
    briefingId: row.briefing_id,
    profileId: row.profile_id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
