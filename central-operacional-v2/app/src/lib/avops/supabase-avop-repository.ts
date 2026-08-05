import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import { hasAudienceIntersection } from './rules';
import type { AvopAcknowledgement, AvopListItem, AvopRepository, AvopStatus } from './types';

type AudienceJoinRow = {
  audience_id: string;
  audiences: { code: string; active: boolean } | null;
};

type AvopRow = {
  id: string;
  number: string;
  title: string;
  publication_date: string;
  drive_url: string | null;
  status: AvopStatus;
  requires_acknowledgement: boolean;
  avop_audiences: Array<{ audiences: { code: string; active: boolean } | null }> | null;
};

type AcknowledgementRow = {
  id: string;
  avop_id: string;
  profile_id: string;
  acknowledged_at: string;
  session_id: string | null;
};

export class SupabaseAvopRepository implements AvopRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async listApplicableAvops(profileId: string, now: Date = new Date()): Promise<AvopListItem[]> {
    const profileAudiences = await this.loadProfileAudiences(profileId, now);
    if (profileAudiences.length === 0) return [];

    const { data, error } = await this.client
      .from('avops')
      .select('id,number,title,publication_date,drive_url,status,requires_acknowledgement,avop_audiences(audiences(code,active))')
      .eq('status', 'PUBLISHED')
      .order('publication_date', { ascending: false })
      .order('number', { ascending: true })
      .returns<AvopRow[]>();
    if (error) throw error;

    const applicable = (data ?? [])
      .map((row) => mapAvopRow(row, null))
      .filter((avop) => hasAudienceIntersection(profileAudiences, avop.audiences));

    const acknowledgements = await this.loadAcknowledgements(profileId, applicable.map((avop) => avop.id));
    return applicable.map((avop) => ({ ...avop, acknowledgement: acknowledgements.get(avop.id) ?? null }));
  }

  async findApplicableAvop(profileId: string, avopId: string, now: Date = new Date()): Promise<AvopListItem | null> {
    const profileAudiences = await this.loadProfileAudiences(profileId, now);
    if (profileAudiences.length === 0) return null;

    const { data, error } = await this.client
      .from('avops')
      .select('id,number,title,publication_date,drive_url,status,requires_acknowledgement,avop_audiences(audiences(code,active))')
      .eq('id', avopId)
      .maybeSingle<AvopRow>();
    if (error) throw error;
    if (!data) return null;

    const acknowledgement = await this.loadAcknowledgement(profileId, avopId);
    const avop = mapAvopRow(data, acknowledgement);
    if (avop.status !== 'PUBLISHED') return null;
    if (!hasAudienceIntersection(profileAudiences, avop.audiences)) return null;
    return avop;
  }

  async acknowledgeAvop(
    profileId: string,
    avopId: string,
    now: Date = new Date(),
    sessionId: string | null = null,
  ): Promise<AvopAcknowledgement> {
    const acknowledgedAt = now.toISOString();
    const { data, error } = await this.client
      .from('avop_acknowledgements')
      .insert({
        avop_id: avopId,
        profile_id: profileId,
        acknowledged_at: acknowledgedAt,
        session_id: sessionId,
        request_metadata: {},
        legacy_source: {},
      })
      .select('id,avop_id,profile_id,acknowledged_at,session_id')
      .single<AcknowledgementRow>();

    if (!error && data) return mapAcknowledgement(data);
    if (isUniqueViolation(error)) {
      const existing = await this.loadAcknowledgement(profileId, avopId);
      if (existing) return existing;
    }
    throw error ?? new Error('Não foi possível registrar a ciência do AVOP.');
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

  private async loadAcknowledgements(profileId: string, avopIds: string[]): Promise<Map<string, AvopAcknowledgement>> {
    if (avopIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('avop_acknowledgements')
      .select('id,avop_id,profile_id,acknowledged_at,session_id')
      .eq('profile_id', profileId)
      .in('avop_id', avopIds)
      .returns<AcknowledgementRow[]>();
    if (error) throw error;
    return new Map((data ?? []).map((row) => [row.avop_id, mapAcknowledgement(row)]));
  }

  private async loadAcknowledgement(profileId: string, avopId: string): Promise<AvopAcknowledgement | null> {
    const { data, error } = await this.client
      .from('avop_acknowledgements')
      .select('id,avop_id,profile_id,acknowledged_at,session_id')
      .eq('profile_id', profileId)
      .eq('avop_id', avopId)
      .maybeSingle<AcknowledgementRow>();
    if (error) throw error;
    return data ? mapAcknowledgement(data) : null;
  }
}

function mapAvopRow(row: AvopRow, acknowledgement: AvopAcknowledgement | null): AvopListItem {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    publicationDate: row.publication_date,
    dueDate: null,
    status: row.status,
    driveUrl: row.drive_url,
    requiresAcknowledgement: row.requires_acknowledgement,
    audiences: (row.avop_audiences ?? [])
      .map((join) => join.audiences)
      .filter((audience): audience is { code: string; active: boolean } => Boolean(audience?.active))
      .map((audience) => audience.code),
    acknowledgement,
  };
}

function mapAcknowledgement(row: AcknowledgementRow): AvopAcknowledgement {
  return {
    id: row.id,
    avopId: row.avop_id,
    profileId: row.profile_id,
    acknowledgedAt: row.acknowledged_at,
    sessionId: row.session_id,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
