import {
  normalizeAudienceList,
  normalizeAvopNumber,
  normalizeText,
  normalizeTrigram,
  normalizeUpper,
} from '../domain/normalization.ts';
import type {
  AvopPayload,
  EfetivoPayload,
  ImportIssue,
  ImportOperation,
  LeituraPayload,
  RawRow,
  SheetImportResult,
  SheetKind,
} from './types.ts';

const REQUIRED_COLUMNS: Record<SheetKind, string[]> = {
  EFETIVO: ['ID', 'NOME', 'ATIVO'],
  AVOPS: ['AVOP_ID', 'TITULO', 'DATA_EMISSAO', 'STATUS', 'PERFIL_ALVO', 'EXIGE_CIENCIA'],
  LEITURAS: ['AVOP_ID', 'ID'],
};

const CANONICAL_AUDIENCES = new Set(['PILOTO', 'TRIPULANTE', 'HSAR', 'TODOS']);

type Parser<TPayload extends Record<string, unknown>> = {
  sheet: SheetKind;
  duplicateKey: (payload: TPayload) => string;
  parseRow: (row: RawRow, rowNumber: number) => ParsedRow<TPayload>;
};

type ParsedRow<TPayload extends Record<string, unknown>> =
  | { ok: true; operation: ImportOperation<TPayload>; normalized: boolean; warnings: ImportIssue[] }
  | { ok: false; issues: ImportIssue[] };

export function parseEfetivo(rows: RawRow[]): SheetImportResult<EfetivoPayload> {
  return parseSheet(rows, {
    sheet: 'EFETIVO',
    duplicateKey: (payload) => payload.trigram,
    parseRow: parseEfetivoRow,
  });
}

export function parseAvops(rows: RawRow[]): SheetImportResult<AvopPayload> {
  return parseSheet(rows, {
    sheet: 'AVOPS',
    duplicateKey: (payload) => payload.number,
    parseRow: parseAvopRow,
  });
}

export function parseLeituras(rows: RawRow[]): SheetImportResult<LeituraPayload> {
  return parseSheet(rows, {
    sheet: 'LEITURAS',
    duplicateKey: (payload) => `${payload.avopNumber}|${payload.trigram}`,
    parseRow: parseLeituraRow,
  });
}

function parseSheet<TPayload extends Record<string, unknown>>(
  rows: RawRow[],
  parser: Parser<TPayload>,
): SheetImportResult<TPayload> {
  const issues: ImportIssue[] = [];
  const operations: ImportOperation<TPayload>[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  let normalized = 0;

  const columnIssues = validateColumns(parser.sheet, rows);
  if (columnIssues.length) {
    return {
      sheet: parser.sheet,
      read: rows.length,
      valid: 0,
      invalid: rows.length,
      duplicates: 0,
      normalized: 0,
      issues: columnIssues,
      operations: [],
    };
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (isEmptyRow(row)) return;

    const parsed = parser.parseRow(row, rowNumber);
    if (!parsed.ok) {
      invalid += 1;
      issues.push(...parsed.issues);
      return;
    }

    issues.push(...parsed.warnings);

    const duplicateKey = parser.duplicateKey(parsed.operation.payload);
    if (seen.has(duplicateKey)) {
      duplicates += 1;
      issues.push(errorIssue(parser.sheet, rowNumber, 'DUPLICATE_ROW', `Registro duplicado para chave ${duplicateKey}.`, row));
      return;
    }

    seen.add(duplicateKey);
    if (parsed.normalized) normalized += 1;
    operations.push(parsed.operation);
  });

  return {
    sheet: parser.sheet,
    read: rows.length,
    valid: operations.length,
    invalid,
    duplicates,
    normalized,
    issues,
    operations,
  };
}

function parseEfetivoRow(row: RawRow, rowNumber: number): ParsedRow<EfetivoPayload> {
  const originalId = normalizeText(row.ID);
  const trigram = normalizeTrigram(originalId);
  const name = normalizeText(row.NOME);
  const email = normalizeText(row.EMAIL) || null;
  const active = parseYesNo(row.ATIVO);
  const rawAudiences = normalizeText(row.PERFIS) || normalizeText(row.PERFIL);
  const audiences = normalizeAudienceList(rawAudiences);
  const issues = requiredValueIssues('EFETIVO', rowNumber, row, [
    ['ID', trigram],
    ['NOME', name],
    ['ATIVO', normalizeText(row.ATIVO)],
  ]);

  if (active === null) {
    issues.push(errorIssue('EFETIVO', rowNumber, 'INVALID_ACTIVE_FLAG', 'ATIVO deve ser SIM ou NAO.', row));
  }

  if (issues.length) return { ok: false, issues };

  const payload: EfetivoPayload = {
    trigram,
    name,
    email,
    active: active === true,
    audiences,
    source: 'EFETIVO',
    originalId,
  };

  return {
    ok: true,
    normalized: originalId !== trigram || rawAudiences !== audiences.join(','),
    warnings: unknownAudienceIssues('EFETIVO', rowNumber, row, rawAudiences, audiences),
    operation: {
      sheet: 'EFETIVO',
      operation: 'upsert',
      idempotencyKey: `profile:${trigram}`,
      payload,
      original: row,
    },
  };
}

function parseAvopRow(row: RawRow, rowNumber: number): ParsedRow<AvopPayload> {
  const originalAvopId = normalizeText(row.AVOP_ID);
  const number = normalizeAvopNumber(originalAvopId);
  const title = normalizeText(row.TITULO);
  const publicationDate = normalizeIsoDate(row.DATA_EMISSAO);
  const status = normalizeUpper(row.STATUS);
  const targetAudiences = normalizeAudienceList(row.PERFIL_ALVO);
  const requiresAcknowledgement = parseYesNo(row.EXIGE_CIENCIA);
  const deadlineDays = normalizeText(row.PRAZO_DIAS) ? Number(row.PRAZO_DIAS) : null;
  const issues = requiredValueIssues('AVOPS', rowNumber, row, [
    ['AVOP_ID', number],
    ['TITULO', title],
    ['DATA_EMISSAO', publicationDate],
    ['STATUS', status],
    ['PERFIL_ALVO', targetAudiences.join(',')],
    ['EXIGE_CIENCIA', normalizeText(row.EXIGE_CIENCIA)],
  ]);

  if (requiresAcknowledgement === null) {
    issues.push(errorIssue('AVOPS', rowNumber, 'INVALID_ACK_FLAG', 'EXIGE_CIENCIA deve ser SIM ou NAO.', row));
  }

  if (deadlineDays !== null && (!Number.isInteger(deadlineDays) || deadlineDays < 0)) {
    issues.push(
      errorIssue('AVOPS', rowNumber, 'INVALID_DEADLINE', 'PRAZO_DIAS deve ser numero inteiro positivo quando informado.', row),
    );
  }

  if (issues.length) return { ok: false, issues };

  const payload: AvopPayload = {
    number,
    title,
    publicationDate,
    deadlineDays,
    webappUrl: normalizeText(row.WEBAPP_URL) || null,
    status,
    targetAudiences,
    requiresAcknowledgement: requiresAcknowledgement === true,
    source: 'AVOPS',
    originalAvopId,
  };

  return {
    ok: true,
    normalized: originalAvopId !== number || normalizeText(row.PERFIL_ALVO) !== targetAudiences.join(','),
    warnings: unknownAudienceIssues('AVOPS', rowNumber, row, row.PERFIL_ALVO, targetAudiences),
    operation: {
      sheet: 'AVOPS',
      operation: 'upsert',
      idempotencyKey: `avop:${number}`,
      payload,
      original: row,
    },
  };
}

function parseLeituraRow(row: RawRow, rowNumber: number): ParsedRow<LeituraPayload> {
  const originalAvopId = normalizeText(row.AVOP_ID);
  const originalId = normalizeText(row.ID);
  const avopNumber = normalizeAvopNumber(originalAvopId);
  const trigram = normalizeTrigram(originalId);
  const acknowledgedAt = normalizeOptionalIsoDate(row.DATA || row.DATA_HORA || row.TIMESTAMP);
  const issues = requiredValueIssues('LEITURAS', rowNumber, row, [
    ['AVOP_ID', avopNumber],
    ['ID', trigram],
  ]);

  if (issues.length) return { ok: false, issues };

  const payload: LeituraPayload = {
    avopNumber,
    trigram,
    acknowledgedAt,
    source: 'LEITURAS',
    originalAvopId,
    originalId,
  };

  return {
    ok: true,
    normalized: originalAvopId !== avopNumber || originalId !== trigram,
    warnings: [],
    operation: {
      sheet: 'LEITURAS',
      operation: 'acknowledge',
      idempotencyKey: `ack:${avopNumber}:${trigram}`,
      payload,
      original: row,
    },
  };
}

function validateColumns(sheet: SheetKind, rows: RawRow[]): ImportIssue[] {
  const sample = rows[0] ?? {};
  const headers = new Set(Object.keys(sample));
  return REQUIRED_COLUMNS[sheet]
    .filter((column) => !headers.has(column))
    .map((column) => errorIssue(sheet, 1, 'MISSING_COLUMN', `Coluna obrigatoria ausente: ${column}.`, sample));
}

function requiredValueIssues(
  sheet: SheetKind,
  rowNumber: number,
  row: RawRow,
  values: Array<[string, string]>,
): ImportIssue[] {
  return values
    .filter(([, value]) => !value)
    .map(([column]) => errorIssue(sheet, rowNumber, 'MISSING_VALUE', `Valor obrigatorio ausente em ${column}.`, row));
}

function isEmptyRow(row: RawRow): boolean {
  return Object.values(row).every((value) => normalizeText(value) === '');
}

function parseYesNo(value: unknown): boolean | null {
  const normalized = normalizeUpper(value);
  if (normalized === 'SIM') return true;
  if (normalized === 'NAO' || normalized === 'NÃO') return false;
  return null;
}

function normalizeIsoDate(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return '';

  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return validDateParts(Number(br[3]), Number(br[2]), Number(br[1]));

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) return validDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  return '';
}

function normalizeOptionalIsoDate(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return normalizeIsoDate(text) || null;
}

function validDateParts(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return '';
  }

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function unknownAudienceIssues(
  sheet: SheetKind,
  rowNumber: number,
  row: RawRow,
  original: unknown,
  audiences: string[],
): ImportIssue[] {
  if (!normalizeText(original)) return [];
  return audiences
    .filter((audience) => !CANONICAL_AUDIENCES.has(audience))
    .map((audience) => ({
      sheet,
      rowNumber,
      severity: 'warning',
      code: 'UNKNOWN_AUDIENCE',
      message: `Publico/perfil desconhecido preservado para auditoria: ${audience}.`,
      raw: row,
    }));
}

function errorIssue(sheet: SheetKind, rowNumber: number, code: string, message: string, raw: RawRow): ImportIssue {
  return {
    sheet,
    rowNumber,
    severity: 'error',
    code,
    message,
    raw,
  };
}
