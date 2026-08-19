import { extractDriveFileId, normalizeAudienceList, normalizeAvopNumber, normalizeTrigram } from '@/lib/domain/normalization';

export type LegacyRow = Record<string, unknown>;

export function mapLegacyProfile(row: LegacyRow) {
  return {
    trigram: normalizeTrigram(row.ID),
    name: String(row.NOME ?? '').trim(),
    email: String(row.EMAIL ?? '').trim().toLowerCase(),
    active: String(row.ATIVO ?? '').trim().toUpperCase() === 'SIM',
    audiences: normalizeAudienceList(row.PERFIS || row.PERFIL),
  };
}

export function mapLegacyAvop(row: LegacyRow) {
  const driveUrl = String(row.PDF_URL || row.LINK_PDF || '').trim();
  return {
    number: normalizeAvopNumber(row.AVOP_ID),
    title: String(row.TITULO ?? '').trim(),
    publicationDate: parseLegacyDate(row.DATA_EMISSAO),
    driveUrl,
    driveFileId: extractDriveFileId(driveUrl),
    status: String(row.STATUS ?? '').trim().toUpperCase() === 'ATIVO' ? 'PUBLISHED' : 'CLOSED',
    audiences: normalizeAudienceList(row.PERFIL_ALVO),
    requiresAcknowledgement: String(row.EXIGE_CIENCIA ?? '').trim().toUpperCase() === 'SIM',
  };
}

export function mapLegacyAcknowledgement(row: LegacyRow) {
  return {
    avopNumber: normalizeAvopNumber(row.AVOP_ID),
    trigram: normalizeTrigram(row.ID),
    acknowledgedAt: parseLegacyDate(row.TIMESTAMP),
    legacyName: String(row.NOME_INFORMADO ?? '').trim(),
  };
}

export function parseLegacyDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = br;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss)));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
