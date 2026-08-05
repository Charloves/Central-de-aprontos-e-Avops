import { hasAudienceIntersection, isValidDriveUrl } from '@/lib/avops/rules';
import type { BriefingListItem, BriefingStatus } from './types';

export const BRIEFING_TIME_ZONE = 'America/Sao_Paulo';
export const MIN_JUSTIFICATION_LENGTH = 3;
export const MAX_JUSTIFICATION_LENGTH = 500;

export function isBriefingApplicable(profileAudiences: string[], briefingAudiences: string[]): boolean {
  return hasAudienceIntersection(profileAudiences, briefingAudiences);
}

export function getEffectiveBriefingStatus(
  briefing: Pick<BriefingListItem, 'status' | 'eventDate'>,
  now: Date = new Date(),
): 'OPEN' | 'CLOSED' {
  if (briefing.status === 'CLOSED') return 'CLOSED';
  if (briefing.status !== 'OPEN') return 'CLOSED';
  if (!briefing.eventDate || !isValidIsoDate(briefing.eventDate)) return 'CLOSED';
  return now.getTime() >= getBriefingCloseInstant(briefing.eventDate).getTime() ? 'CLOSED' : 'OPEN';
}

export function getBriefingCloseInstant(eventDate: string): Date {
  if (!isValidIsoDate(eventDate)) return new Date(Number.NaN);
  const [year, month, day] = eventDate.split('-').map(Number);
  const closeDate = new Date(Date.UTC(year, month - 1, day + 3, 3, 0, 0, 0));
  return closeDate;
}

export function getBriefingStatusLabel(status: BriefingStatus, effectiveStatus: 'OPEN' | 'CLOSED'): string {
  if (effectiveStatus === 'CLOSED') return 'FECHADO';
  if (status === 'OPEN') return 'ABERTO';
  return status;
}

export function getAttendanceLabel(record: BriefingListItem['record']): string {
  if (!record) return 'Sem registro';
  if (record.attendanceStatus === 'PRESENTE') return 'Presente';
  if (record.attendanceStatus === 'AUSENTE') return 'Falta';
  if (record.attendanceStatus === 'JUSTIFICADO') return 'Justificado';
  if (record.attendanceStatus === 'PENDENTE') return 'Pendente';
  return 'Registro legado';
}

export function getJustificationLabel(briefing: BriefingListItem): string {
  return briefing.latestJustification ? 'Justificativa registrada' : 'Sem justificativa';
}

export function getMaterialLabel(briefing: BriefingListItem): string {
  if (!briefing.requiresMaterialAcknowledgement) return 'Ciência não exigida';
  if (briefing.record?.materialAcknowledged) return 'Material ciente';
  return 'Ciência pendente';
}

export function canAcknowledgeMaterial(briefing: BriefingListItem): boolean {
  return briefing.effectiveStatus === 'OPEN'
    && briefing.requiresMaterialAcknowledgement
    && !briefing.record?.materialAcknowledged
    && isValidDriveUrl(briefing.driveUrl);
}

export function canJustifyAbsence(briefing: BriefingListItem): boolean {
  return briefing.effectiveStatus === 'OPEN';
}

export function normalizeJustificationText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < MIN_JUSTIFICATION_LENGTH || normalized.length > MAX_JUSTIFICATION_LENGTH) return null;
  if (/<\/?[a-z][\s\S]*>/i.test(normalized)) return null;
  if (/javascript\s*:/i.test(normalized)) return null;
  return normalized;
}

export function hasClientSuppliedBriefingIdentity(formData: FormData): boolean {
  const forbiddenFields = new Set(['profileid', 'profile_id', 'trigram', 'trigrama', 'sessionid', 'session_id']);
  return Array.from(formData.keys()).some((key) => forbiddenFields.has(key.toLowerCase()));
}

export function isValidBriefingMaterialUrl(value: string | null, environment = process.env.NODE_ENV): boolean {
  return isValidDriveUrl(value, environment);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
