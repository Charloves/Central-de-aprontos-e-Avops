export type SheetKind =
  | 'EFETIVO'
  | 'AVOPS'
  | 'LEITURAS'
  | 'APRONTOS'
  | 'PRESENCAS'
  | 'OI_H50'
  | 'OI_H125'
  | 'EMAIL_LOG'
  | 'ACESSOS_LOG';

export type SourceFormat = 'csv' | 'json';

export type RawRow = Record<string, unknown>;

export type ImportIssue = {
  sheet: SheetKind;
  rowNumber: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  raw: RawRow;
};

export type ImportOperation<TPayload extends Record<string, unknown>> = {
  sheet: SheetKind;
  operation: 'upsert' | 'link' | 'acknowledge' | 'stage';
  idempotencyKey: string;
  payload: TPayload;
  original: RawRow;
};

export type SheetImportResult<TPayload extends Record<string, unknown>> = {
  sheet: SheetKind;
  read: number;
  valid: number;
  invalid: number;
  duplicates: number;
  normalized: number;
  metrics?: Record<string, number>;
  issues: ImportIssue[];
  operations: Array<ImportOperation<TPayload | HistoricalStagingPayload>>;
};

export type ImportReport = {
  dryRun: true;
  generatedAt: string;
  sheets: SheetImportResult<Record<string, unknown>>[];
  totals: {
    read: number;
    valid: number;
    invalid: number;
    duplicates: number;
    normalized: number;
    operations: number;
    metrics: Record<string, number>;
  };
};

export type EfetivoPayload = {
  trigram: string;
  name: string;
  email: string | null;
  active: boolean;
  audiences: string[];
  source: 'EFETIVO';
  originalId: string;
};

export type AvopPayload = {
  number: string;
  title: string;
  publicationDate: string;
  deadlineDays: number | null;
  webappUrl: string | null;
  status: string;
  targetAudiences: string[];
  requiresAcknowledgement: boolean;
  source: 'AVOPS';
  originalAvopId: string;
};

export type LeituraPayload = {
  avopNumber: string;
  trigram: string;
  acknowledgedAt: string | null;
  source: 'LEITURAS';
  originalAvopId: string;
  originalId: string;
};

export type AprontoPayload = {
  briefingId: string;
  title: string;
  eventDate: string;
  status: string;
  targetAudiences: string[];
  materialUrl: string | null;
  requiresMaterialAcknowledgement: boolean;
  source: 'APRONTOS';
  originalBriefingId: string;
};

export type PresencaPayload = {
  briefingId: string;
  trigram: string;
  attendanceStatus: 'PRESENTE' | 'JUSTIFICADO' | 'AUSENTE' | 'PENDENTE' | null;
  hasAttendance: boolean;
  hasAbsence: boolean;
  justificationText: string | null;
  materialAcknowledged: boolean;
  recordedAt: string | null;
  source: 'PRESENCAS';
  originalBriefingId: string;
  originalId: string;
};

export type OiPayload = {
  aircraft: 'H50' | 'H125';
  oiKey: string;
  program: string;
  subprogram: string;
  phaseId: string;
  title: string;
  driveUrl: string;
  driveFileId: string | null;
  startPage: number;
  endPage: number | null;
  displayKey: string;
  type: string;
  status: string;
  missionCodes: string[];
  active: boolean;
  source: 'OI_H50' | 'OI_H125';
  originalOiKey: string;
};

export type EmailLogPayload = {
  attemptedAt: string;
  avopNumber: string | null;
  trigram: string | null;
  recipient: string;
  notificationType: 'COBRANCA' | 'DIVULGACAO' | 'TESTE_COBRANCA' | 'JOB_COBRANCA' | 'OUTRO';
  originalType: string;
  result: 'ENVIADO' | 'ERRO' | 'INICIADO' | 'CONCLUIDO' | 'OUTRO';
  originalResult: string;
  errorMessage: string | null;
  observation: string | null;
  source: 'EMAIL_LOG';
  originalAvopId: string;
  originalId: string;
};

export type AccessLogPayload = {
  occurredAt: string;
  trigram: string | null;
  module: string;
  action: string;
  detail: string | null;
  status: 'OK' | 'NEGADO' | 'ERRO' | 'OUTRO';
  accessType: 'LOGIN_VALIDO' | 'LOGIN_INVALIDO' | 'ACESSO_ADMINISTRATIVO' | 'ACESSO' | 'OUTRO';
  entityType: string;
  entityId: string;
  source: 'ACESSOS_LOG';
  originalId: string;
};

export type HistoricalStagingPayload = {
  sourceSheet: SheetKind;
  sourceRecordType: string;
  rowNumber: number;
  classification: 'valid' | 'invalid' | 'ambiguous' | 'duplicate' | 'imported';
  original: RawRow;
  normalized: RawRow | null;
  issues: Array<Pick<ImportIssue, 'severity' | 'code' | 'message'>>;
  limitationReason: string;
  migrated: boolean;
  resolvedEntityType: string | null;
  resolvedEntityId: string | null;
};
