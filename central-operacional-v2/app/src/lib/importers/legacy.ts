import {
  normalizeAudienceList,
  normalizeAvopNumber,
  normalizeText,
  normalizeTrigram,
  normalizeUpper,
} from '../domain/normalization.ts';
import type {
  AprontoPayload,
  AvopPayload,
  EfetivoPayload,
  HistoricalStagingPayload,
  ImportIssue,
  ImportOperation,
  LeituraPayload,
  PresencaPayload,
  RawRow,
  SheetImportResult,
  SheetKind,
} from './types.ts';

const REQUIRED_COLUMNS: Record<SheetKind, string[]> = {
  EFETIVO: ['ID', 'NOME', 'ATIVO'],
  AVOPS: ['AVOP_ID', 'TITULO', 'DATA_EMISSAO', 'STATUS', 'PERFIL_ALVO', 'EXIGE_CIENCIA'],
  LEITURAS: ['AVOP_ID', 'ID'],
  APRONTOS: ['APRONTO_ID', 'TITULO', 'DATA', 'STATUS', 'EXIGE_CIENCIA_MATERIAL'],
  PRESENCAS: ['APRONTO_ID', 'ID'],
};

const CANONICAL_AUDIENCES = new Set(['PILOTO', 'TRIPULANTE', 'HSAR', 'TODOS']);
const KNOWN_BRIEFING_STATUSES = new Set(['ABERTO', 'FECHADO', 'DRAFT']);
const KNOWN_ATTENDANCE_STATUSES = new Set(['PRESENTE', 'JUSTIFICADO', 'AUSENTE', 'PENDENTE']);

type Parser<TPayload extends Record<string, unknown>> = {
  sheet: SheetKind;
  duplicateKey: (payload: TPayload) => string;
  parseRow: (row: RawRow, rowNumber: number) => ParsedRow<TPayload>;
  stageDuplicate?: boolean;
};

type ParsedRow<TPayload extends Record<string, unknown>> =
  | { ok: true; operation: ImportOperation<TPayload | HistoricalStagingPayload>; normalized: boolean; warnings: ImportIssue[] }
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

export function parseAprontos(rows: RawRow[]): SheetImportResult<AprontoPayload> {
  const result = parseSheet(rows, {
    sheet: 'APRONTOS',
    duplicateKey: (payload) => payload.briefingId,
    parseRow: parseAprontoRow,
  });

  return {
    ...result,
    metrics: {
      aprontos: result.operations.filter((operation) => operation.operation !== 'stage').length,
      fechados: result.operations
        .filter((operation) => operation.operation !== 'stage')
        .map((operation) => operation.payload)
        .filter(isAprontoPayload)
        .filter((payload) => payload.status === 'FECHADO').length,
    },
  };
}

export function parsePresencas(rows: RawRow[]): SheetImportResult<PresencaPayload> {
  const result = parseSheet(rows, {
    sheet: 'PRESENCAS',
    duplicateKey: (payload) => `${payload.briefingId}|${payload.trigram}`,
    parseRow: parsePresencaRow,
    stageDuplicate: true,
  });

  return {
    ...result,
    metrics: buildPresencaMetrics(
      result.operations
        .filter((operation) => operation.operation !== 'stage')
        .map((operation) => operation.payload)
        .filter(isPresencaPayload),
      result.operations
        .filter((operation) => operation.operation === 'stage')
        .map((operation) => operation.payload)
        .filter(isStagingPayload),
    ),
  };
}

function parseSheet<TPayload extends Record<string, unknown>>(
  rows: RawRow[],
  parser: Parser<TPayload>,
): SheetImportResult<TPayload> {
  const issues: ImportIssue[] = [];
  const operations: Array<ImportOperation<TPayload | HistoricalStagingPayload>> = [];
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

    if (parsed.operation.operation === 'stage') {
      operations.push(parsed.operation);
      if (parsed.normalized) normalized += 1;
      return;
    }

    const duplicateKey = parser.duplicateKey(parsed.operation.payload as TPayload);
    if (seen.has(duplicateKey)) {
      duplicates += 1;
      const issue = errorIssue(parser.sheet, rowNumber, 'DUPLICATE_ROW', `Registro duplicado para chave ${duplicateKey}.`, row);
      issues.push(issue);
      if (parser.stageDuplicate) {
        operations.push(createStagingOperation(parser.sheet, rowNumber, row, parsed.operation.payload, [issue], 'duplicate', duplicateKey));
      }
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

function parseAprontoRow(row: RawRow, rowNumber: number): ParsedRow<AprontoPayload> {
  const originalBriefingId = normalizeText(row.APRONTO_ID);
  const briefingId = normalizeBriefingId(originalBriefingId);
  const title = normalizeText(row.TITULO);
  const eventDate = normalizeIsoDate(row.DATA);
  const status = normalizeUpper(row.STATUS);
  const rawAudience = normalizeText(row.PERFIL_ALVO) || normalizeText(row.PUBLICO);
  const targetAudiences = normalizeAudienceList(rawAudience);
  const requiresMaterialAcknowledgement = parseYesNo(row.EXIGE_CIENCIA_MATERIAL);
  const issues = requiredValueIssues('APRONTOS', rowNumber, row, [
    ['APRONTO_ID', briefingId],
    ['TITULO', title],
    ['DATA', eventDate],
    ['STATUS', status],
    ['PERFIL_ALVO/PUBLICO', targetAudiences.join(',')],
    ['EXIGE_CIENCIA_MATERIAL', normalizeText(row.EXIGE_CIENCIA_MATERIAL)],
  ]);
  const warnings = [
    ...unknownAudienceIssues('APRONTOS', rowNumber, row, rawAudience, targetAudiences),
    ...unknownStatusIssues('APRONTOS', rowNumber, row, status, KNOWN_BRIEFING_STATUSES, 'UNKNOWN_BRIEFING_STATUS'),
  ];

  if (requiresMaterialAcknowledgement === null) {
    issues.push(errorIssue('APRONTOS', rowNumber, 'INVALID_MATERIAL_ACK_FLAG', 'EXIGE_CIENCIA_MATERIAL deve ser SIM ou NAO.', row));
  }

  if (issues.length) return { ok: false, issues };

  const payload: AprontoPayload = {
    briefingId,
    title,
    eventDate,
    status,
    targetAudiences,
    materialUrl: normalizeText(row.LINK_MATERIAL) || null,
    requiresMaterialAcknowledgement: requiresMaterialAcknowledgement === true,
    source: 'APRONTOS',
    originalBriefingId,
  };

  return {
    ok: true,
    normalized: originalBriefingId !== briefingId || rawAudience !== targetAudiences.join(','),
    warnings,
    operation: {
      sheet: 'APRONTOS',
      operation: 'upsert',
      idempotencyKey: `briefing:${briefingId}`,
      payload,
      original: row,
    },
  };
}

function parsePresencaRow(row: RawRow, rowNumber: number): ParsedRow<PresencaPayload> {
  const originalBriefingId = normalizeText(row.APRONTO_ID);
  const originalId = normalizeText(row.ID);
  const briefingId = normalizeBriefingId(originalBriefingId);
  const trigram = normalizeTrigram(originalId);
  const status = normalizeUpper(row.STATUS);
  const attendanceStatus = status ? parseAttendanceStatus(status) : null;
  const justificationText = normalizeText(row.OBS) || normalizeText(row.JUSTIFICATIVA) || null;
  const materialAcknowledged = parseYesNo(row.CIENCIA_MATERIAL) === true;
  const recordedAt = normalizeOptionalIsoDate(row.DATA || row.DATA_HORA || row.TIMESTAMP);
  const isAmbiguous = attendanceStatus === null;
  const issues = requiredValueIssues('PRESENCAS', rowNumber, row, [
    ['APRONTO_ID', briefingId],
    ['ID', trigram],
  ]);
  const warnings: ImportIssue[] = [];

  if (status && attendanceStatus === null) {
    warnings.push(
      warningIssue('PRESENCAS', rowNumber, 'UNKNOWN_ATTENDANCE_STATUS', `Status de presenca desconhecido preservado para auditoria: ${status}.`, row),
    );
  }

  if (isAmbiguous) {
    warnings.push(
      warningIssue(
        'PRESENCAS',
        rowNumber,
        'AMBIGUOUS_EMPTY_RECORD',
        'Registro sem status, justificativa ou ciencia de material. Linha preservada sem inventar classificacao.',
        row,
      ),
    );
  }

  if (justificationText && attendanceStatus !== 'JUSTIFICADO') {
    warnings.push(
      warningIssue(
        'PRESENCAS',
        rowNumber,
        'JUSTIFICATION_WITHOUT_JUSTIFIED_STATUS',
        'Justificativa encontrada sem STATUS JUSTIFICADO. Texto preservado para auditoria.',
        row,
      ),
    );
  }

  if (isAmbiguous && (status || justificationText || materialAcknowledged)) {
    warnings.push(
      warningIssue(
        'PRESENCAS',
        rowNumber,
        'AMBIGUOUS_WITHOUT_DEFINITIVE_STATUS',
        'Linha possui informacao parcial, mas nao tem attendance_status definitivo para briefing_records.',
        row,
      ),
    );
  }

  if (issues.length) return { ok: false, issues };

  const payload: PresencaPayload = {
    briefingId,
    trigram,
    attendanceStatus,
    hasAttendance: attendanceStatus === 'PRESENTE',
    hasAbsence: attendanceStatus === 'AUSENTE' || attendanceStatus === 'JUSTIFICADO',
    justificationText,
    materialAcknowledged,
    recordedAt,
    source: 'PRESENCAS',
    originalBriefingId,
    originalId,
  };

  if (isAmbiguous) {
    return {
      ok: true,
      normalized: originalBriefingId !== briefingId || originalId !== trigram,
      warnings,
      operation: createStagingOperation(
        'PRESENCAS',
        rowNumber,
        row,
        {
          briefingId,
          trigram,
          status,
          attendanceStatus,
          justificationText,
          materialAcknowledged,
          recordedAt,
          source: 'PRESENCAS',
          originalBriefingId,
          originalId,
        },
        warnings,
        'ambiguous',
        `${briefingId}|${trigram}`,
      ),
    };
  }

  return {
    ok: true,
    normalized: originalBriefingId !== briefingId || originalId !== trigram || status !== (attendanceStatus ?? status),
    warnings,
    operation: {
      sheet: 'PRESENCAS',
      operation: 'link',
      idempotencyKey: `briefing-record:${briefingId}:${trigram}`,
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

function parseAttendanceStatus(value: unknown): PresencaPayload['attendanceStatus'] {
  const normalized = normalizeUpper(value);
  if (KNOWN_ATTENDANCE_STATUSES.has(normalized)) return normalized as PresencaPayload['attendanceStatus'];
  return null;
}

function normalizeBriefingId(value: unknown): string {
  const raw = normalizeUpper(value);
  if (!raw) return '';

  const match = raw.match(/^APR\D*(\d{4})\D*(\d{3})$/);
  if (match) return `APR-${match[1]}-${match[2]}`;

  return raw.replace(/\s+/g, ' ');
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

function unknownStatusIssues(
  sheet: SheetKind,
  rowNumber: number,
  row: RawRow,
  status: string,
  known: Set<string>,
  code: string,
): ImportIssue[] {
  if (!status || known.has(status)) return [];
  return [warningIssue(sheet, rowNumber, code, `Status desconhecido preservado para auditoria: ${status}.`, row)];
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

function warningIssue(sheet: SheetKind, rowNumber: number, code: string, message: string, raw: RawRow): ImportIssue {
  return {
    sheet,
    rowNumber,
    severity: 'warning',
    code,
    message,
    raw,
  };
}

function buildPresencaMetrics(rows: PresencaPayload[], stagedRows: HistoricalStagingPayload[] = []): Record<string, number> {
  return {
    presencas: rows.filter((row) => row.hasAttendance).length,
    faltas: rows.filter((row) => row.attendanceStatus === 'AUSENTE' || row.attendanceStatus === 'JUSTIFICADO').length,
    justificativas:
      rows.filter((row) => row.justificationText).length +
      stagedRows.filter((row) => isNormalizedValue(row.normalized, 'justificationText')).length,
    cienciasMaterial:
      rows.filter((row) => row.materialAcknowledged).length +
      stagedRows.filter((row) => row.normalized?.materialAcknowledged === true).length,
    stagingAmbiguos: stagedRows.filter((row) => row.classification === 'ambiguous').length,
    stagingDuplicados: stagedRows.filter((row) => row.classification === 'duplicate').length,
  };
}

function createStagingOperation(
  sheet: SheetKind,
  rowNumber: number,
  original: RawRow,
  normalized: RawRow | null,
  issues: ImportIssue[],
  classification: HistoricalStagingPayload['classification'],
  sourceKey: string,
): ImportOperation<HistoricalStagingPayload> {
  const payload: HistoricalStagingPayload = {
    sourceSheet: sheet,
    sourceRecordType: sheet,
    rowNumber,
    classification,
    original,
    normalized,
    issues: issues.map(({ severity, code, message }) => ({ severity, code, message })),
    limitationReason:
      classification === 'ambiguous'
        ? 'registro historico ambiguo sem status, justificativa ou ciencia de material'
        : 'registro historico duplicado preservado para auditoria',
    migrated: true,
    resolvedEntityType: null,
    resolvedEntityId: null,
  };

  return {
    sheet,
    operation: 'stage',
    idempotencyKey: `staging:${sheet}:${classification}:${rowNumber}:${sourceKey}`,
    payload,
    original,
  };
}

function isPresencaPayload(payload: PresencaPayload | HistoricalStagingPayload): payload is PresencaPayload {
  return 'source' in payload && payload.source === 'PRESENCAS';
}

function isStagingPayload(payload: PresencaPayload | HistoricalStagingPayload): payload is HistoricalStagingPayload {
  return 'classification' in payload && 'sourceRecordType' in payload;
}

function isAprontoPayload(payload: AprontoPayload | HistoricalStagingPayload): payload is AprontoPayload {
  return 'source' in payload && payload.source === 'APRONTOS';
}

function isNormalizedValue(normalized: RawRow | null, key: string): boolean {
  return Boolean(normalized?.[key]);
}
