import { isBriefingApplicable, getEffectiveBriefingStatus } from './rules';
import type {
  AbsenceJustification,
  BriefingListItem,
  BriefingRecord,
  BriefingRepository,
} from './types';

export type FakeBriefingProfile = {
  id: string;
  active: boolean;
  audiences: string[];
};

export class FakeBriefingRepository implements BriefingRepository {
  private readonly profiles = new Map<string, FakeBriefingProfile>();
  private readonly briefings = new Map<string, BriefingListItem>();
  private readonly records = new Map<string, BriefingRecord>();
  private readonly justifications: AbsenceJustification[] = [];
  materialWrites = 0;
  justificationWrites = 0;

  constructor(input: {
    profiles: FakeBriefingProfile[];
    briefings: BriefingListItem[];
    records?: BriefingRecord[];
    justifications?: AbsenceJustification[];
  }) {
    input.profiles.forEach((profile) => this.profiles.set(profile.id, profile));
    input.briefings.forEach((briefing) => this.briefings.set(briefing.id, { ...briefing }));
    input.records?.forEach((record) => this.records.set(key(record.profileId, record.briefingId), record));
    input.justifications?.forEach((justification) => this.justifications.push(justification));
  }

  async listApplicableBriefings(profileId: string, now: Date = new Date()): Promise<BriefingListItem[]> {
    const profile = this.profiles.get(profileId);
    if (!profile?.active) return [];

    return [...this.briefings.values()]
      .filter((briefing) => briefing.status !== 'DRAFT')
      .filter((briefing) => isBriefingApplicable(profile.audiences, briefing.audiences))
      .map((briefing) => this.withState(profileId, briefing, now))
      .sort((a, b) => (b.eventDate ?? '').localeCompare(a.eventDate ?? '') || a.legacyId.localeCompare(b.legacyId));
  }

  async findApplicableBriefing(profileId: string, briefingId: string, now: Date = new Date()): Promise<BriefingListItem | null> {
    const profile = this.profiles.get(profileId);
    const briefing = this.briefings.get(briefingId);
    if (!profile?.active || !briefing || briefing.status === 'DRAFT') return null;
    if (!isBriefingApplicable(profile.audiences, briefing.audiences)) return null;
    return this.withState(profileId, briefing, now);
  }

  async acknowledgeMaterial(
    profileId: string,
    briefingId: string,
    now: Date = new Date(),
  ): Promise<BriefingRecord> {
    const recordKey = key(profileId, briefingId);
    const existing = this.records.get(recordKey);
    if (existing) {
      if (existing.materialAcknowledged) return existing;
      const updated = { ...existing, materialAcknowledged: true };
      this.records.set(recordKey, updated);
      this.materialWrites += 1;
      return updated;
    }

    const created: BriefingRecord = {
      id: `briefing-record-${this.records.size + 1}`,
      briefingId,
      profileId,
      attendanceStatus: 'PENDENTE',
      materialAcknowledged: true,
      recordedAt: now.toISOString(),
    };
    this.records.set(recordKey, created);
    this.materialWrites += 1;
    return created;
  }

  async createJustification(
    profileId: string,
    briefingId: string,
    text: string,
    now: Date = new Date(),
  ): Promise<AbsenceJustification> {
    const created: AbsenceJustification = {
      id: `justification-${this.justifications.length + 1}`,
      briefingId,
      profileId,
      text,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.justifications.push(created);
    this.justificationWrites += 1;
    return created;
  }

  private withState(profileId: string, briefing: BriefingListItem, now: Date): BriefingListItem {
    const record = this.records.get(key(profileId, briefing.id)) ?? briefing.record;
    const justifications = this.justifications
      .filter((item) => item.profileId === profileId && item.briefingId === briefing.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      ...briefing,
      effectiveStatus: getEffectiveBriefingStatus(briefing, now),
      record,
      latestJustification: justifications[0] ?? briefing.latestJustification,
    };
  }
}

function key(profileId: string, briefingId: string): string {
  return `${profileId}:${briefingId}`;
}
