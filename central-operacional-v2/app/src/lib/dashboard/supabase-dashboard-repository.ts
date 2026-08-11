import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import { getEffectiveStatusForDashboard, buildOperationalMembers } from './rules';
import type {
  DashboardAvopRecord,
  DashboardAvopSource,
  DashboardBriefingRecord,
  DashboardBriefingSource,
  DashboardJustificationRecord,
  DashboardMember,
  DashboardRepository,
  DenominatorSource,
} from './types';

type AudienceJoin = { audiences: { code: string; name: string | null; active: boolean } | null };

type AvopRow = {
  id: string;
  number: string;
  title: string;
  publication_date: string;
  status: string;
  requires_acknowledgement: boolean;
  avop_audiences: AudienceJoin[] | null;
};

type BriefingRow = {
  id: string;
  legacy_id: string | null;
  title: string;
  event_date: string | null;
  status: string;
  requires_material_acknowledgement: boolean;
  briefing_audiences: AudienceJoin[] | null;
};

type ProfileAudienceRow = {
  profile_id: string;
  valid_from: string | null;
  valid_to: string | null;
  profiles: { id: string; trigram: string; name: string; active: boolean } | null;
  audiences: { code: string; name: string | null; active: boolean } | null;
};

type AvopSnapshotRow = {
  id: string;
  avop_id: string;
  applicable_profile_count: number;
  historical_limitations: unknown;
};

type BriefingSnapshotRow = {
  id: string;
  briefing_id: string;
  applicable_profile_count: number;
  historical_limitations: unknown;
};

type SnapshotMemberRow = {
  snapshot_id: string;
  profile_id: string;
  trigram_snapshot: string;
  name_snapshot: string;
  audience_code_snapshot: string;
  profile_active_snapshot: boolean;
  historical_profile_available: boolean;
  limitation_reason: string | null;
};

type AvopAcknowledgementRow = {
  avop_id: string;
  profile_id: string;
  acknowledged_at: string;
};

type BriefingRecordRow = {
  briefing_id: string;
  profile_id: string;
  attendance_status: string;
  material_acknowledged: boolean;
  recorded_at: string;
};

type JustificationRow = {
  briefing_id: string;
  profile_id: string;
  created_at: string;
};

export class SupabaseDashboardRepository implements DashboardRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async loadDashboard(now: Date = new Date()): Promise<{
    avops: DashboardAvopSource[];
    briefings: DashboardBriefingSource[];
  }> {
    const [avops, briefings, currentMembers] = await Promise.all([
      this.loadAvops(),
      this.loadBriefings(),
      this.loadCurrentMembers(now),
    ]);
    const avopIds = avops.map((item) => item.id);
    const briefingIds = briefings.map((item) => item.id);
    const [avopSnapshots, avopSnapshotMembers, acknowledgements, briefingSnapshots, briefingSnapshotMembers, records, justifications] =
      await Promise.all([
        this.loadAvopSnapshots(avopIds),
        this.loadAvopSnapshotMembers(avopIds),
        this.loadAcknowledgements(avopIds),
        this.loadBriefingSnapshots(briefingIds),
        this.loadBriefingSnapshotMembers(briefingIds),
        this.loadBriefingRecords(briefingIds),
        this.loadJustifications(briefingIds),
      ]);

    return {
      avops: avops.map((avop) => {
        const snapshot = avopSnapshots.get(avop.id);
        const members = snapshot
          ? avopSnapshotMembers.get(snapshot.id) ?? []
          : buildOperationalMembers({ profiles: currentMembers, itemAudiences: avop.audiences });
        return {
          ...avop,
          denominatorSource: snapshot ? sourceFromSnapshot(snapshot.historical_limitations) : 'OPERATIONAL_CURRENT',
          members,
          acknowledgements: acknowledgements.get(avop.id) ?? [],
        };
      }),
      briefings: briefings.map((briefing) => {
        const snapshot = briefingSnapshots.get(briefing.id);
        const members = snapshot
          ? briefingSnapshotMembers.get(snapshot.id) ?? []
          : buildOperationalMembers({ profiles: currentMembers, itemAudiences: briefing.audiences });
        return {
          ...briefing,
          effectiveStatus: getEffectiveStatusForDashboard(briefing, now),
          denominatorSource: snapshot ? sourceFromSnapshot(snapshot.historical_limitations) : 'OPERATIONAL_CURRENT',
          members,
          records: records.get(briefing.id) ?? [],
          justifications: justifications.get(briefing.id) ?? [],
        };
      }),
    };
  }

  private async loadAvops(): Promise<Omit<DashboardAvopSource, 'denominatorSource' | 'members' | 'acknowledgements'>[]> {
    const { data, error } = await this.client
      .from('avops')
      .select('id,number,title,publication_date,status,requires_acknowledgement,avop_audiences(audiences(code,name,active))')
      .neq('status', 'DRAFT')
      .order('publication_date', { ascending: false })
      .order('number', { ascending: true })
      .returns<AvopRow[]>();
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      publicationDate: row.publication_date,
      status: row.status,
      requiresAcknowledgement: row.requires_acknowledgement,
      audiences: extractAudiences(row.avop_audiences),
    }));
  }

  private async loadBriefings(): Promise<Omit<DashboardBriefingSource, 'denominatorSource' | 'members' | 'records' | 'justifications'>[]> {
    const { data, error } = await this.client
      .from('briefings')
      .select('id,legacy_id,title,event_date,status,requires_material_acknowledgement,briefing_audiences(audiences(code,name,active))')
      .neq('status', 'DRAFT')
      .order('event_date', { ascending: false })
      .order('legacy_id', { ascending: true })
      .returns<BriefingRow[]>();
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      legacyId: row.legacy_id ?? row.id,
      title: row.title,
      eventDate: row.event_date,
      status: row.status,
      effectiveStatus: 'CLOSED',
      requiresMaterialAcknowledgement: row.requires_material_acknowledgement,
      audiences: extractAudiences(row.briefing_audiences),
    }));
  }

  private async loadCurrentMembers(now: Date): Promise<DashboardMember[]> {
    const date = now.toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('profile_audiences')
      .select('profile_id,valid_from,valid_to,profiles(id,trigram,name,active),audiences(code,name,active)')
      .or(`valid_from.is.null,valid_from.lte.${date}`)
      .or(`valid_to.is.null,valid_to.gte.${date}`)
      .returns<ProfileAudienceRow[]>();
    if (error) throw error;

    const byProfile = new Map<string, DashboardMember>();
    for (const row of data ?? []) {
      if (!row.profiles?.active || !row.audiences?.active) continue;
      const existing = byProfile.get(row.profile_id);
      if (!existing) {
        byProfile.set(row.profile_id, {
          profileId: row.profile_id,
          trigram: row.profiles.trigram,
          name: row.profiles.name,
          audiences: [row.audiences.code],
          active: row.profiles.active,
          historicalProfileAvailable: true,
          limitationReason: null,
        });
      } else if (!existing.audiences.includes(row.audiences.code)) {
        existing.audiences.push(row.audiences.code);
      }
    }
    return [...byProfile.values()];
  }

  private async loadAvopSnapshots(avopIds: string[]): Promise<Map<string, AvopSnapshotRow>> {
    if (avopIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('avop_publication_snapshots')
      .select('id,avop_id,applicable_profile_count,historical_limitations')
      .in('avop_id', avopIds)
      .returns<AvopSnapshotRow[]>();
    if (error) throw error;
    return new Map((data ?? []).map((row) => [row.avop_id, row]));
  }

  private async loadBriefingSnapshots(briefingIds: string[]): Promise<Map<string, BriefingSnapshotRow>> {
    if (briefingIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('briefing_publication_snapshots')
      .select('id,briefing_id,applicable_profile_count,historical_limitations')
      .in('briefing_id', briefingIds)
      .returns<BriefingSnapshotRow[]>();
    if (error) throw error;
    return new Map((data ?? []).map((row) => [row.briefing_id, row]));
  }

  private async loadAvopSnapshotMembers(avopIds: string[]): Promise<Map<string, DashboardMember[]>> {
    if (avopIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('avop_publication_snapshot_members')
      .select('snapshot_id,profile_id,trigram_snapshot,name_snapshot,audience_code_snapshot,profile_active_snapshot,historical_profile_available,limitation_reason')
      .in('avop_id', avopIds)
      .returns<SnapshotMemberRow[]>();
    if (error) throw error;
    return groupSnapshotMembers(data ?? []);
  }

  private async loadBriefingSnapshotMembers(briefingIds: string[]): Promise<Map<string, DashboardMember[]>> {
    if (briefingIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('briefing_publication_snapshot_members')
      .select('snapshot_id,profile_id,trigram_snapshot,name_snapshot,audience_code_snapshot,profile_active_snapshot,historical_profile_available,limitation_reason')
      .in('briefing_id', briefingIds)
      .returns<SnapshotMemberRow[]>();
    if (error) throw error;
    return groupSnapshotMembers(data ?? []);
  }

  private async loadAcknowledgements(avopIds: string[]): Promise<Map<string, DashboardAvopRecord[]>> {
    if (avopIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('avop_acknowledgements')
      .select('avop_id,profile_id,acknowledged_at')
      .in('avop_id', avopIds)
      .returns<AvopAcknowledgementRow[]>();
    if (error) throw error;
    return groupRows(data ?? [], (row) => row.avop_id, (row) => ({
      avopId: row.avop_id,
      profileId: row.profile_id,
      acknowledgedAt: row.acknowledged_at,
    }));
  }

  private async loadBriefingRecords(briefingIds: string[]): Promise<Map<string, DashboardBriefingRecord[]>> {
    if (briefingIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('briefing_records')
      .select('briefing_id,profile_id,attendance_status,material_acknowledged,recorded_at')
      .in('briefing_id', briefingIds)
      .returns<BriefingRecordRow[]>();
    if (error) throw error;
    return groupRows(data ?? [], (row) => row.briefing_id, (row) => ({
      briefingId: row.briefing_id,
      profileId: row.profile_id,
      attendanceStatus: row.attendance_status,
      materialAcknowledged: row.material_acknowledged,
      recordedAt: row.recorded_at,
    }));
  }

  private async loadJustifications(briefingIds: string[]): Promise<Map<string, DashboardJustificationRecord[]>> {
    if (briefingIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('absence_justifications')
      .select('briefing_id,profile_id,created_at')
      .in('briefing_id', briefingIds)
      .returns<JustificationRow[]>();
    if (error) throw error;
    return groupRows(data ?? [], (row) => row.briefing_id, (row) => ({
      briefingId: row.briefing_id,
      profileId: row.profile_id,
      createdAt: row.created_at,
    }));
  }
}

function extractAudiences(rows: AudienceJoin[] | null): string[] {
  return (rows ?? [])
    .map((row) => row.audiences)
    .filter((audience): audience is { code: string; name: string | null; active: boolean } => Boolean(audience?.active))
    .map((audience) => audience.code);
}

function groupSnapshotMembers(rows: SnapshotMemberRow[]): Map<string, DashboardMember[]> {
  return groupRows(rows, (row) => row.snapshot_id, (row) => ({
    profileId: row.profile_id,
    trigram: row.trigram_snapshot,
    name: row.name_snapshot,
    audiences: [row.audience_code_snapshot],
    active: row.profile_active_snapshot,
    historicalProfileAvailable: row.historical_profile_available,
    limitationReason: row.limitation_reason,
  }));
}

function groupRows<T, U>(rows: T[], key: (row: T) => string, map: (row: T) => U): Map<string, U[]> {
  const grouped = new Map<string, U[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const current = grouped.get(groupKey) ?? [];
    current.push(map(row));
    grouped.set(groupKey, current);
  }
  return grouped;
}

function sourceFromSnapshot(limitations: unknown): DenominatorSource {
  return Array.isArray(limitations) && limitations.length > 0 ? 'HISTORICAL_UNAVAILABLE' : 'SNAPSHOT';
}
