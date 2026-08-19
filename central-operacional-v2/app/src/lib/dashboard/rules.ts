import { getEffectiveBriefingStatus } from '@/lib/briefings/rules';
import { hasAudienceIntersection } from '@/lib/avops/rules';
import type {
  AuditItemType,
  AuditRow,
  DashboardAvopSource,
  DashboardAvopSummary,
  DashboardBriefingSource,
  DashboardBriefingSummary,
  DashboardMember,
  DashboardRepository,
  DenominatorSource,
  ManagementDashboard,
  PaginatedAudit,
  Percentage,
} from './types';

export const AUDIT_DEFAULT_PAGE_SIZE = 25;
export const AUDIT_MAX_PAGE_SIZE = 100;

export function buildManagementDashboard(input: {
  avops: DashboardAvopSource[];
  briefings: DashboardBriefingSource[];
}): ManagementDashboard {
  return {
    avops: input.avops.map(summarizeAvop),
    briefings: input.briefings.map(summarizeBriefing),
  };
}

export async function loadManagementDashboard(
  repository: DashboardRepository,
  now?: Date,
): Promise<ManagementDashboard> {
  return buildManagementDashboard(await repository.loadDashboard(now));
}

export async function loadNominalAudit(input: {
  repository: DashboardRepository;
  itemType: AuditItemType;
  itemId: string;
  page?: number;
  pageSize?: number;
  now?: Date;
}): Promise<PaginatedAudit | null> {
  const page = clampInteger(input.page, 1, Number.MAX_SAFE_INTEGER, 1);
  const pageSize = clampInteger(input.pageSize, 1, AUDIT_MAX_PAGE_SIZE, AUDIT_DEFAULT_PAGE_SIZE);
  const dashboard = await input.repository.loadDashboard(input.now);
  const source = input.itemType === 'avop'
    ? dashboard.avops.find((item) => item.id === input.itemId)
    : dashboard.briefings.find((item) => item.id === input.itemId);
  if (!source) return null;

  const rows = input.itemType === 'avop'
    ? buildAvopAuditRows(source as DashboardAvopSource)
    : buildBriefingAuditRows(source as DashboardBriefingSource);
  const start = (page - 1) * pageSize;

  return {
    itemType: input.itemType,
    itemId: input.itemId,
    itemLabel: input.itemType === 'avop'
      ? `${(source as DashboardAvopSource).number} - ${source.title}`
      : `${(source as DashboardBriefingSource).legacyId} - ${source.title}`,
    denominatorSource: source.denominatorSource,
    totalRows: rows.length,
    page,
    pageSize,
    rows: rows.slice(start, start + pageSize),
  };
}

export function summarizeAvop(avop: DashboardAvopSource): DashboardAvopSummary {
  const members = dedupeMembers(avop.members);
  const memberIds = new Set(members.map((member) => member.profileId));
  const acknowledgedProfiles = new Set(
    avop.acknowledgements
      .filter((ack) => memberIds.has(ack.profileId))
      .map((ack) => ack.profileId),
  );
  const totalApplicable = members.length;
  const acknowledged = acknowledgedProfiles.size;
  const pending = Math.max(totalApplicable - acknowledged, 0);

  return {
    id: avop.id,
    number: avop.number,
    title: avop.title,
    publicationDate: avop.publicationDate,
    status: avop.status,
    denominatorSource: resolveDenominatorSource(avop.denominatorSource, members),
    hasHistoricalLimitation: hasHistoricalLimitation(members, avop.denominatorSource),
    totalApplicable,
    acknowledged,
    pending,
    acknowledgementPercent: percentage(acknowledged, totalApplicable),
    pendingPercent: percentage(pending, totalApplicable),
  };
}

export function summarizeBriefing(briefing: DashboardBriefingSource): DashboardBriefingSummary {
  const members = dedupeMembers(briefing.members);
  const memberIds = new Set(members.map((member) => member.profileId));
  const recordsByProfile = firstRecordByProfile(briefing.records.filter((record) => memberIds.has(record.profileId)));
  const justificationsByProfile = firstDateByProfile(briefing.justifications.filter((item) => memberIds.has(item.profileId)));
  let present = 0;
  let absent = 0;
  let justified = 0;
  let pending = 0;
  let materialAcknowledged = 0;

  for (const member of members) {
    const record = recordsByProfile.get(member.profileId) ?? null;
    const hasJustification = justificationsByProfile.has(member.profileId);
    if (record?.materialAcknowledged) materialAcknowledged += 1;

    const situation = classifyBriefingSituation(record?.attendanceStatus ?? null, hasJustification);
    if (situation === 'PRESENTE') present += 1;
    else if (situation === 'AUSENTE') absent += 1;
    else if (situation === 'JUSTIFICADO') justified += 1;
    else pending += 1;
  }

  const totalApplicable = members.length;
  return {
    id: briefing.id,
    legacyId: briefing.legacyId,
    title: briefing.title,
    eventDate: briefing.eventDate,
    status: briefing.status,
    effectiveStatus: briefing.effectiveStatus,
    denominatorSource: resolveDenominatorSource(briefing.denominatorSource, members),
    hasHistoricalLimitation: hasHistoricalLimitation(members, briefing.denominatorSource),
    totalApplicable,
    present,
    absent,
    justified,
    pending,
    materialAcknowledged,
    presentPercent: percentage(present, totalApplicable),
    absentPercent: percentage(absent, totalApplicable),
    justifiedPercent: percentage(justified, totalApplicable),
    pendingPercent: percentage(pending, totalApplicable),
    materialAcknowledgedPercent: percentage(materialAcknowledged, totalApplicable),
  };
}

export function buildAvopAuditRows(avop: DashboardAvopSource): AuditRow[] {
  const acknowledgementByProfile = firstDateByProfile(avop.acknowledgements.map((ack) => ({
    profileId: ack.profileId,
    createdAt: ack.acknowledgedAt,
  })));

  return sortAuditRows(dedupeMembers(avop.members).map((member) => {
    const acknowledgedAt = acknowledgementByProfile.get(member.profileId) ?? null;
    return {
      profileId: member.profileId,
      name: member.name,
      trigram: member.trigram,
      audiences: member.audiences,
      situation: acknowledgedAt ? 'CIENTE' : 'PENDENTE',
      eventAt: acknowledgedAt,
      historicalProfileAvailable: member.historicalProfileAvailable,
      limitationReason: member.limitationReason,
    };
  }));
}

export function buildBriefingAuditRows(briefing: DashboardBriefingSource): AuditRow[] {
  const recordsByProfile = firstRecordByProfile(briefing.records);
  const justificationsByProfile = firstDateByProfile(briefing.justifications);

  return sortAuditRows(dedupeMembers(briefing.members).map((member) => {
    const record = recordsByProfile.get(member.profileId) ?? null;
    const justificationAt = justificationsByProfile.get(member.profileId) ?? null;
    const situation = classifyBriefingSituation(record?.attendanceStatus ?? null, Boolean(justificationAt));
    const eventAt = situation === 'JUSTIFICADO' ? justificationAt : record?.recordedAt ?? null;
    return {
      profileId: member.profileId,
      name: member.name,
      trigram: member.trigram,
      audiences: member.audiences,
      situation,
      eventAt,
      materialAcknowledged: Boolean(record?.materialAcknowledged),
      materialAcknowledgedAt: record?.materialAcknowledged ? record.recordedAt : null,
      historicalProfileAvailable: member.historicalProfileAvailable,
      limitationReason: member.limitationReason,
    };
  }));
}

export function buildOperationalMembers(input: {
  profiles: DashboardMember[];
  itemAudiences: string[];
}): DashboardMember[] {
  return dedupeMembers(input.profiles.filter((member) => {
    if (!member.active) return false;
    if (member.audiences.length === 0) return false;
    return hasAudienceIntersection(member.audiences, input.itemAudiences);
  }));
}

export function percentage(numerator: number, denominator: number): Percentage {
  if (denominator <= 0) return { value: 0, label: '0,0%' };
  const value = Math.round((numerator / denominator) * 1000) / 10;
  return { value, label: `${value.toFixed(1).replace('.', ',')}%` };
}

export function denominatorLabel(source: DenominatorSource): string {
  if (source === 'SNAPSHOT') return 'Snapshot de publicação';
  if (source === 'OPERATIONAL_CURRENT') return 'Efetivo ativo atual';
  return 'Histórico indisponível';
}

export function auditSituationLabel(situation: AuditRow['situation']): string {
  if (situation === 'CIENTE') return 'Ciente';
  if (situation === 'PRESENTE') return 'Presente';
  if (situation === 'AUSENTE') return 'Ausente';
  if (situation === 'JUSTIFICADO') return 'Justificado';
  if (situation === 'SEM_CLASSIFICACAO') return 'Sem classificação';
  return 'Pendente';
}

export function getEffectiveStatusForDashboard(
  briefing: Pick<DashboardBriefingSource, 'status' | 'eventDate'>,
  now: Date,
): 'OPEN' | 'CLOSED' {
  return getEffectiveBriefingStatus({ status: briefing.status as never, eventDate: briefing.eventDate }, now);
}

function classifyBriefingSituation(
  attendanceStatus: string | null,
  hasJustification: boolean,
): AuditRow['situation'] {
  const normalized = (attendanceStatus ?? '').trim().toUpperCase();
  if (normalized === 'PRESENTE') return 'PRESENTE';
  if (normalized === 'JUSTIFICADO' || hasJustification) return 'JUSTIFICADO';
  if (normalized === 'AUSENTE') return 'AUSENTE';
  if (!normalized || normalized === 'PENDENTE') return 'PENDENTE';
  return 'SEM_CLASSIFICACAO';
}

function dedupeMembers(members: DashboardMember[]): DashboardMember[] {
  const byProfile = new Map<string, DashboardMember>();
  for (const member of members) {
    const existing = byProfile.get(member.profileId);
    if (!existing) {
      byProfile.set(member.profileId, {
        ...member,
        audiences: uniqueSorted(member.audiences),
      });
      continue;
    }
    byProfile.set(member.profileId, {
      ...existing,
      audiences: uniqueSorted([...existing.audiences, ...member.audiences]),
      active: existing.active || member.active,
      historicalProfileAvailable: existing.historicalProfileAvailable && member.historicalProfileAvailable,
      limitationReason: existing.limitationReason ?? member.limitationReason,
    });
  }
  return [...byProfile.values()].sort(compareMembers);
}

function firstRecordByProfile<T extends { profileId: string; recordedAt: string }>(records: T[]): Map<string, T> {
  const byProfile = new Map<string, T>();
  for (const record of [...records].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    if (!byProfile.has(record.profileId)) byProfile.set(record.profileId, record);
  }
  return byProfile;
}

function firstDateByProfile<T extends { profileId: string; createdAt?: string; acknowledgedAt?: string }>(items: T[]): Map<string, string> {
  const rows = items
    .map((item) => ({ profileId: item.profileId, date: item.createdAt ?? item.acknowledgedAt ?? '' }))
    .filter((item) => item.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const byProfile = new Map<string, string>();
  for (const row of rows) {
    if (!byProfile.has(row.profileId)) byProfile.set(row.profileId, row.date);
  }
  return byProfile;
}

function sortAuditRows(rows: AuditRow[]): AuditRow[] {
  return [...rows].sort((a, b) => {
    const situation = auditSituationRank(a.situation) - auditSituationRank(b.situation);
    if (situation !== 0) return situation;
    const name = a.name.localeCompare(b.name, 'pt-BR');
    if (name !== 0) return name;
    return a.trigram.localeCompare(b.trigram, 'pt-BR');
  });
}

function auditSituationRank(situation: AuditRow['situation']): number {
  if (situation === 'PENDENTE' || situation === 'SEM_CLASSIFICACAO') return 0;
  if (situation === 'AUSENTE') return 1;
  if (situation === 'JUSTIFICADO') return 2;
  if (situation === 'PRESENTE') return 3;
  return 4;
}

function compareMembers(a: DashboardMember, b: DashboardMember): number {
  const name = a.name.localeCompare(b.name, 'pt-BR');
  if (name !== 0) return name;
  return a.trigram.localeCompare(b.trigram, 'pt-BR');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))].sort();
}

function hasHistoricalLimitation(members: DashboardMember[], source: DenominatorSource): boolean {
  return source === 'HISTORICAL_UNAVAILABLE' || members.some((member) => !member.historicalProfileAvailable || member.limitationReason);
}

function resolveDenominatorSource(source: DenominatorSource, members: DashboardMember[]): DenominatorSource {
  if (source !== 'SNAPSHOT') return source;
  return members.some((member) => !member.historicalProfileAvailable) ? 'HISTORICAL_UNAVAILABLE' : 'SNAPSHOT';
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
