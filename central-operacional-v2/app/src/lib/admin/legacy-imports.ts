import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hasAdminRole } from '@/lib/auth/session';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import {
  buildImportReport,
  parseAcessosLog,
  parseAprontos,
  parseAvops,
  parseEfetivo,
  parseEmailLog,
  parseLeituras,
  parseOiH125,
  parseOiH50,
  parsePresencas,
} from '@/lib/importers';
import { parseCsv } from '@/lib/importers/csv';
import type { ImportIssue, ImportOperation, ImportReport, RawRow, SheetImportResult, SheetKind } from '@/lib/importers/types';

export const LEGACY_IMPORT_CONFIRMATION_COOKIE = 'central_v2_legacy_import_confirmation';
export const LEGACY_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const LEGACY_IMPORT_ALLOWED_EXTENSIONS = ['.csv', '.json'] as const;

const IMPORT_KIND_LABELS: Record<SheetKind, string> = {
  EFETIVO: 'Efetivo',
  AVOPS: 'AVOPs',
  LEITURAS: 'Leituras de AVOP',
  APRONTOS: 'Aprontos',
  PRESENCAS: 'Presenças',
  OI_H50: 'OI H50',
  OI_H125: 'OI H125',
  EMAIL_LOG: 'Log de e-mail',
  ACESSOS_LOG: 'Log de acessos',
};

const IMPORT_KIND_PARSERS: Record<SheetKind, (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>> = {
  EFETIVO: parseEfetivo as (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>,
  AVOPS: parseAvops as (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>,
  LEITURAS: parseLeituras as (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>,
  APRONTOS: parseAprontos as (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>,
  PRESENCAS: parsePresencas as (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>,
  OI_H50: parseOiH50 as (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>,
  OI_H125: parseOiH125 as (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>,
  EMAIL_LOG: parseEmailLog as (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>,
  ACESSOS_LOG: parseAcessosLog as (rows: RawRow[]) => SheetImportResult<Record<string, unknown>>,
};

export type LegacyImportReferenceSnapshot = {
  trigrams: string[];
  adminTrigrams: string[];
  avopNumbers: string[];
  briefingLegacyIds: string[];
  oiKeys: string[];
  audienceCodes: string[];
};

export type LegacyImportPreviewInput = {
  actorProfileId: string;
  kind: SheetKind;
  fileName: string;
  fileBytes: Uint8Array;
  now?: Date;
};

export type LegacyImportBatchSummary = {
  batchId: string;
  sourceFileName: string;
  sourceFileHash: string;
  validationFingerprint: string;
  status: 'OPEN' | 'VALIDATED' | 'APPLIED' | 'CANCELED' | 'FAILED';
  report: SanitizedImportReport;
  confirmationToken?: string;
};

export type LegacyImportApplyResult =
  | { ok: true; batchId: string; appliedRecords: number; auditId: string; alreadyApplied?: boolean }
  | { ok: false; reason: 'FORBIDDEN' | 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_READY' | 'INTERNAL_ERROR' };

export type LegacyImportRepository = {
  getReferenceSnapshot(): Promise<LegacyImportReferenceSnapshot>;
  createPreviewBatch(input: {
    actorProfileId: string;
    kind: SheetKind;
    fileName: string;
    sourceFileHash: string;
    validationFingerprint: string;
    confirmationTokenHash: string;
    report: SanitizedImportReport;
    operations: Array<ImportOperation<Record<string, unknown>>>;
    now?: Date;
  }): Promise<LegacyImportBatchSummary>;
  findBatch(batchId: string): Promise<LegacyImportBatchSummary | null>;
  applyBatch(input: {
    actorProfileId: string;
    batchId: string;
    confirmationToken: string;
    now?: Date;
  }): Promise<LegacyImportApplyResult>;
  cancelBatch(input: {
    actorProfileId: string;
    batchId: string;
    now?: Date;
  }): Promise<LegacyImportApplyResult>;
};

export type LegacyImportPreviewResult =
  | { ok: true; batch: LegacyImportBatchSummary }
  | { ok: false; reason: 'FORBIDDEN' | 'INVALID_INPUT' | 'INVALID_FILE' | 'INTERNAL_ERROR' };

export type SanitizedImportIssue = Omit<ImportIssue, 'raw'> & {
  sample: Record<string, unknown>;
};

export type SanitizedImportOperation = {
  sheet: SheetKind;
  operation: ImportOperation<Record<string, unknown>>['operation'];
  idempotencyKeyHash: string;
  classification: 'valid' | 'invalid' | 'ambiguous' | 'duplicate' | 'imported';
  sample: Record<string, unknown>;
  issues: Array<Pick<ImportIssue, 'severity' | 'code' | 'message'>>;
};

export type SanitizedImportReport = Omit<ImportReport, 'sheets'> & {
  canApply: boolean;
  issuesByCategory: Record<string, number>;
  sheets: Array<Omit<SheetImportResult<Record<string, unknown>>, 'issues' | 'operations'> & {
    label: string;
    issues: SanitizedImportIssue[];
    operations: SanitizedImportOperation[];
  }>;
};

export async function createLegacyImportPreviewForSession(input: {
  session: AuthenticatedSession;
  formData: FormData;
  repository: LegacyImportRepository;
  now?: Date;
}): Promise<LegacyImportPreviewResult> {
  if (!input.session.roles.includes('ADMIN')) return { ok: false, reason: 'FORBIDDEN' };
  if (hasForbiddenIdentity(input.formData)) return { ok: false, reason: 'INVALID_INPUT' };

  const kind = parseImportKind(input.formData.get('kind'));
  const file = input.formData.get('file');
  if (!kind || !(file instanceof File)) return { ok: false, reason: 'INVALID_INPUT' };

  const fileValidation = validateLegacyImportFile(file);
  if (!fileValidation.ok) return { ok: false, reason: 'INVALID_FILE' };

  try {
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const sourceFileHash = sha256Bytes(fileBytes);
    const rows = parseImportRows(file.name, new TextDecoder('utf-8', { fatal: true }).decode(fileBytes));
    const parsed = IMPORT_KIND_PARSERS[kind](rows);
    const reference = await input.repository.getReferenceSnapshot();
    const report = sanitizeImportReport(classifyAgainstReferences(parsed, reference), {
      generatedAt: (input.now ?? new Date()).toISOString(),
    });
    const validationFingerprint = sha256Json({
      kind,
      sourceFileHash,
      totals: report.totals,
      issues: report.issuesByCategory,
    });
    const confirmationToken = randomBytes(32).toString('base64url');
    const batch = await input.repository.createPreviewBatch({
      actorProfileId: input.session.profileId,
      kind,
      fileName: sanitizeFileName(file.name),
      sourceFileHash,
      validationFingerprint,
      confirmationTokenHash: sha256Text(confirmationToken),
      report,
      operations: report.canApply ? extractOperations(parsed) : extractOperationsForStaging(parsed),
      now: input.now,
    });

    return { ok: true, batch: { ...batch, confirmationToken } };
  } catch {
    return { ok: false, reason: 'INTERNAL_ERROR' };
  }
}

export async function applyLegacyImportForSession(input: {
  session: AuthenticatedSession;
  formData: FormData;
  confirmationToken: string | undefined;
  repository: LegacyImportRepository;
  now?: Date;
}): Promise<LegacyImportApplyResult> {
  if (!input.session.roles.includes('ADMIN')) return { ok: false, reason: 'FORBIDDEN' };
  if (hasForbiddenIdentity(input.formData)) return { ok: false, reason: 'INVALID_INPUT' };
  const batchId = parseUuid(input.formData.get('batchId'));
  if (!batchId || !input.confirmationToken) return { ok: false, reason: 'INVALID_INPUT' };
  return input.repository.applyBatch({
    actorProfileId: input.session.profileId,
    batchId,
    confirmationToken: input.confirmationToken,
    now: input.now,
  });
}

export async function cancelLegacyImportForSession(input: {
  session: AuthenticatedSession;
  formData: FormData;
  repository: LegacyImportRepository;
  now?: Date;
}): Promise<LegacyImportApplyResult> {
  if (!hasAdminRole(input.session.roles)) return { ok: false, reason: 'FORBIDDEN' };
  if (hasForbiddenIdentity(input.formData)) return { ok: false, reason: 'INVALID_INPUT' };
  const batchId = parseUuid(input.formData.get('batchId'));
  if (!batchId) return { ok: false, reason: 'INVALID_INPUT' };
  return input.repository.cancelBatch({
    actorProfileId: input.session.profileId,
    batchId,
    now: input.now,
  });
}

export function validateLegacyImportFile(file: File): { ok: true } | { ok: false; reason: string } {
  const name = sanitizeFileName(file.name);
  if (name !== file.name || hasControlCharacter(file.name)) return { ok: false, reason: 'INVALID_NAME' };
  if (file.size <= 0 || file.size > LEGACY_IMPORT_MAX_FILE_BYTES) return { ok: false, reason: 'INVALID_SIZE' };
  const lower = name.toLowerCase();
  if (!LEGACY_IMPORT_ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return { ok: false, reason: 'INVALID_EXTENSION' };
  }
  return { ok: true };
}

export function parseImportRows(fileName: string, text: string): RawRow[] {
  if (fileName.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed) || parsed.some((row) => !isPlainObject(row))) {
      throw new Error('invalid json import file');
    }
    return parsed as RawRow[];
  }
  return parseCsv(text);
}

export function classifyAgainstReferences(
  sheet: SheetImportResult<Record<string, unknown>>,
  reference: LegacyImportReferenceSnapshot,
): SheetImportResult<Record<string, unknown>> {
  const existing = {
    trigrams: new Set(reference.trigrams),
    admins: new Set(reference.adminTrigrams),
    avops: new Set(reference.avopNumbers),
    briefings: new Set(reference.briefingLegacyIds),
    ois: new Set(reference.oiKeys),
    audiences: new Set(reference.audienceCodes),
  };
  const issues = [...sheet.issues];
  const operations: Array<ImportOperation<Record<string, unknown>>> = [];
  let invalid = sheet.invalid;
  let duplicates = sheet.duplicates;

  for (const operation of sheet.operations as Array<ImportOperation<Record<string, unknown>>>) {
    const rowIssues = validateOperationAgainstReferences(operation, existing);
    if (rowIssues.length) {
      issues.push(...rowIssues);
      operations.push(toStagingOperation(operation, rowIssues, rowIssues.some((issue) => issue.code.includes('DUPLICATE')) ? 'duplicate' : 'invalid'));
      if (rowIssues.some((issue) => issue.code.includes('DUPLICATE'))) duplicates += 1;
      else invalid += 1;
      continue;
    }
    operations.push(operation);
  }

  return {
    ...sheet,
    invalid,
    duplicates,
    valid: operations.filter((operation) => operation.operation !== 'stage').length,
    issues,
    operations,
  };
}

export function sanitizeImportReport(
  sheet: SheetImportResult<Record<string, unknown>>,
  input: { generatedAt: string },
): SanitizedImportReport {
  const report = buildImportReport([sheet], input.generatedAt, { redact: true });
  const unresolved = sheet.operations.some((operation) => operation.operation === 'stage')
    || sheet.issues.some((issue) => issue.severity === 'error');
  return {
    ...report,
    canApply: !unresolved && sheet.valid > 0,
    issuesByCategory: sheet.issues.reduce<Record<string, number>>((totals, issue) => {
      totals[issue.code] = (totals[issue.code] ?? 0) + 1;
      return totals;
    }, {}),
    sheets: [{
      ...report.sheets[0],
      label: IMPORT_KIND_LABELS[sheet.sheet],
      issues: sheet.issues.map((issue) => ({
        sheet: issue.sheet,
        rowNumber: issue.rowNumber,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        sample: sanitizeSample(issue.raw),
      })),
      operations: sheet.operations.map((operation) => sanitizeOperation(operation)),
    }],
  };
}

export function encodeConfirmationCookie(batchId: string, token: string): string {
  return `${batchId}.${token}`;
}

export function decodeConfirmationCookie(value: string | undefined, batchId: string): string | undefined {
  if (!value) return undefined;
  const [cookieBatchId, token] = value.split('.');
  if (!cookieBatchId || !token || !safeEqual(cookieBatchId, batchId)) return undefined;
  return token;
}

export function confirmationTokenHash(token: string): string {
  return sha256Text(token);
}

function validateOperationAgainstReferences(
  operation: ImportOperation<Record<string, unknown>>,
  existing: {
    trigrams: Set<string>;
    admins: Set<string>;
    avops: Set<string>;
    briefings: Set<string>;
    ois: Set<string>;
    audiences: Set<string>;
  },
): ImportIssue[] {
  const payload = operation.payload;
  const issues: ImportIssue[] = [];
  const rowNumber = rowNumberFromOperation(operation);
  const sheet = operation.sheet;
  const audiences = audiencePayload(operation);
  if (Object.values(operation.original).some((value) => typeof value === 'string' && isFormulaLike(value))) {
    issues.push(issue(sheet, rowNumber, 'CSV_FORMULA_INJECTION', 'Conteúdo com fórmula ou comando de planilha não pode ser aplicado automaticamente.', operation.original));
  }

  for (const audience of audiences) {
    if (!existing.audiences.has(audience)) {
      issues.push(issue(sheet, rowNumber, 'UNKNOWN_AUDIENCE_REFERENCE', 'Público inexistente no banco de destino.', operation.original));
    }
  }

  if (sheet === 'EFETIVO') {
    const trigram = String(payload.trigram ?? '');
    if (existing.admins.has(trigram)) {
      issues.push(issue(sheet, rowNumber, 'ADMIN_PROFILE_PROTECTED', 'Administrador existente não pode ser alterado por importação.', operation.original));
    } else if (existing.trigrams.has(trigram)) {
      issues.push(issue(sheet, rowNumber, 'DUPLICATE_EXISTING_PROFILE', 'Trigrama já existe no banco de destino.', operation.original));
    }
    const email = String(payload.email ?? '');
    if (email && !isSafeEmail(email)) {
      issues.push(issue(sheet, rowNumber, 'INVALID_EMAIL', 'E-mail inválido.', operation.original));
    }
  }

  if (sheet === 'AVOPS' && existing.avops.has(String(payload.number ?? ''))) {
    issues.push(issue(sheet, rowNumber, 'DUPLICATE_EXISTING_AVOP', 'AVOP já existe no banco de destino.', operation.original));
  }

  if (sheet === 'APRONTOS' && existing.briefings.has(String(payload.briefingId ?? ''))) {
    issues.push(issue(sheet, rowNumber, 'DUPLICATE_EXISTING_BRIEFING', 'Apronto já existe no banco de destino.', operation.original));
  }

  if ((sheet === 'OI_H50' || sheet === 'OI_H125') && existing.ois.has(`${payload.aircraft}|${payload.oiKey}`)) {
    issues.push(issue(sheet, rowNumber, 'DUPLICATE_EXISTING_OI', 'OI já existe no banco de destino.', operation.original));
  }

  if (sheet === 'LEITURAS') {
    if (!existing.trigrams.has(String(payload.trigram ?? ''))) {
      issues.push(issue(sheet, rowNumber, 'MISSING_PROFILE_REFERENCE', 'Perfil referenciado não existe no banco de destino.', operation.original));
    }
    if (!existing.avops.has(String(payload.avopNumber ?? ''))) {
      issues.push(issue(sheet, rowNumber, 'MISSING_AVOP_REFERENCE', 'AVOP referenciado não existe no banco de destino.', operation.original));
    }
  }

  if (sheet === 'PRESENCAS') {
    if (!existing.trigrams.has(String(payload.trigram ?? ''))) {
      issues.push(issue(sheet, rowNumber, 'MISSING_PROFILE_REFERENCE', 'Perfil referenciado não existe no banco de destino.', operation.original));
    }
    if (!existing.briefings.has(String(payload.briefingId ?? ''))) {
      issues.push(issue(sheet, rowNumber, 'MISSING_BRIEFING_REFERENCE', 'Apronto referenciado não existe no banco de destino.', operation.original));
    }
    if (payload.attendanceStatus === null && payload.justificationText === null && payload.materialAcknowledged !== true) {
      issues.push(issue(sheet, rowNumber, 'AMBIGUOUS_EMPTY_RECORD', 'Registro ambíguo exige decisão humana.', operation.original, 'warning'));
    }
  }

  return issues;
}

function toStagingOperation(
  operation: ImportOperation<Record<string, unknown>>,
  issues: ImportIssue[],
  classification: 'invalid' | 'duplicate' | 'ambiguous',
): ImportOperation<Record<string, unknown>> {
  return {
    ...operation,
    operation: 'stage',
    idempotencyKey: `${operation.idempotencyKey}:staged:${sha256Json(issues.map((item) => item.code))}`,
    payload: {
      sourceSheet: operation.sheet,
      sourceRecordType: operation.sheet,
      rowNumber: rowNumberFromOperation(operation),
      classification,
      original: operation.original,
      normalized: operation.payload,
      issues: issues.map(({ severity, code, message }) => ({ severity, code, message })),
      limitationReason: 'registro legado exige resolução antes da aplicação definitiva',
      migrated: false,
      resolvedEntityType: null,
      resolvedEntityId: null,
    },
  };
}

function extractOperations(sheet: SheetImportResult<Record<string, unknown>>): Array<ImportOperation<Record<string, unknown>>> {
  return sheet.operations.filter((operation) => operation.operation !== 'stage') as Array<ImportOperation<Record<string, unknown>>>;
}

function extractOperationsForStaging(sheet: SheetImportResult<Record<string, unknown>>): Array<ImportOperation<Record<string, unknown>>> {
  return sheet.operations as Array<ImportOperation<Record<string, unknown>>>;
}

function sanitizeOperation(operation: ImportOperation<Record<string, unknown>>): SanitizedImportOperation {
  const payload = operation.operation === 'stage' && isPlainObject(operation.payload.normalized)
    ? operation.payload.normalized as Record<string, unknown>
    : operation.payload;
  const stagedIssues = operation.operation === 'stage' && Array.isArray(operation.payload.issues)
    ? operation.payload.issues as Array<Pick<ImportIssue, 'severity' | 'code' | 'message'>>
    : [];
  return {
    sheet: operation.sheet,
    operation: operation.operation,
    idempotencyKeyHash: sha256Text(operation.idempotencyKey),
    classification: operation.operation === 'stage' ? String(operation.payload.classification ?? 'invalid') as SanitizedImportOperation['classification'] : 'valid',
    sample: { rowNumber: rowNumberFromOperation(operation), ...sanitizeSample(payload) },
    issues: stagedIssues,
  };
}

function sanitizeSample(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).slice(0, 8).map(([key, value]) => {
      if (isSensitiveField(key)) return [key, value ? '[REDACTED]' : value];
      if (typeof value === 'string' && isFormulaLike(value)) return [key, '[FORMULA_REDACTED]'];
      if (Array.isArray(value)) return [key, value.slice(0, 5)];
      if (isPlainObject(value)) return [key, '[OBJECT]'];
      return [key, value];
    }),
  );
}

function isSensitiveField(key: string): boolean {
  return /nome|name|email|trigram|trigrama|id|token|secret|cookie|senha|password|justificativa|obs|message|mensagem/i.test(key);
}

function isFormulaLike(value: string): boolean {
  return /^[=+\-@]/.test(value.trim());
}

function audiencePayload(operation: ImportOperation<Record<string, unknown>>): string[] {
  const payload = operation.payload;
  const source = payload.targetAudiences ?? payload.audiences;
  return Array.isArray(source) ? source.map(String) : [];
}

function rowNumberFromOperation(operation: ImportOperation<Record<string, unknown>>): number {
  const payload = operation.payload;
  return typeof payload.rowNumber === 'number' ? payload.rowNumber : 0;
}

function parseImportKind(value: FormDataEntryValue | null): SheetKind | null {
  const kind = String(value ?? '').trim().toUpperCase();
  return Object.hasOwn(IMPORT_KIND_PARSERS, kind) ? kind as SheetKind : null;
}

function parseUuid(value: FormDataEntryValue | null): string | null {
  const id = String(value ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

function hasForbiddenIdentity(formData: FormData): boolean {
  const forbidden = new Set([
    'actor_profile_id',
    'actorprofileid',
    'profile_id',
    'profileid',
    'trigram',
    'trigrama',
    'role',
    'roles',
    'session_id',
    'sessionid',
  ]);
  return Array.from(formData.keys()).some((key) => forbidden.has(key.toLowerCase()));
}

function sanitizeFileName(value: string): string {
  return value.replace(/^.*[\\/]/, '').trim();
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isSafeEmail(value: string): boolean {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value)
    && !/[\s,;\u0000-\u001f\u007f]/.test(value);
}

function issue(
  sheet: SheetKind,
  rowNumber: number,
  code: string,
  message: string,
  raw: RawRow,
  severity: ImportIssue['severity'] = 'error',
): ImportIssue {
  return { sheet, rowNumber, severity, code, message, raw };
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Json(value: unknown): string {
  return sha256Text(canonicalSerialize(value));
}

function canonicalSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
