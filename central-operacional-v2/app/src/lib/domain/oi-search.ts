import type { OiRecord } from './types';
import { normalizeUpper } from './normalization';

export function normalizeOiCompact(value: unknown): string {
  return normalizeUpper(value).replace(/[^A-Z0-9]/g, '');
}

export function extractPhaseCodes(value: unknown): string[] {
  return [...new Set(normalizeOiCompact(value).match(/\d{2}[A-Z]{2}\d{2}/g) ?? [])];
}

export function extractMissionCodes(value: unknown): string[] {
  return [...new Set(normalizeOiCompact(value).match(/\d{2}[A-Z]{2}\d{2}[A-Z]\d{2}/g) ?? [])];
}

export function searchOi(records: OiRecord[], query: string, aircraft: OiRecord['aircraft']): OiRecord[] {
  const compact = normalizeOiCompact(query);
  if (compact.length < 3) return [];

  const queryMission = extractMissionCodes(query)[0] ?? '';
  const queryPhase = queryMission ? queryMission.slice(0, 6) : (extractPhaseCodes(query)[0] ?? compact.slice(0, 6));

  return records
    .filter((record) => record.active && record.aircraft === aircraft)
    .map((record) => ({ record, score: scoreRecord(record, compact, queryMission, queryPhase) }))
    .filter((item) => item.score < 999)
    .sort((a, b) => a.score - b.score || a.record.oiKey.localeCompare(b.record.oiKey))
    .map((item) => item.record);
}

function scoreRecord(record: OiRecord, compact: string, queryMission: string, queryPhase: string): number {
  const phaseCodes = [
    record.phaseId,
    record.displayKey,
    record.oiKey,
    record.missionCodes.join(' '),
  ].flatMap(extractPhaseCodes);
  const missionCodes = record.missionCodes.map(normalizeOiCompact);
  const fields = [
    record.oiKey,
    record.phaseId,
    record.displayKey,
    record.title,
    record.program,
    record.subprogram,
    record.missionCodes.join(' '),
  ].map(normalizeOiCompact);

  if (queryMission) {
    if (missionCodes.includes(queryMission)) return 0;
    if (missionCodes.length && phaseCodes.includes(queryPhase)) return 999;
    if (!missionCodes.length && phaseCodes.includes(queryPhase)) return 2;
  }

  if (phaseCodes.includes(queryPhase)) return compact.length === 6 ? 0 : 1;
  if (compact.length >= 4 && phaseCodes.some((code) => code.startsWith(compact))) return 2;
  if (fields.some((field) => field === compact)) return 3;
  if (compact.length >= 3 && fields.some((field) => field.includes(compact))) return 7;
  return 999;
}
