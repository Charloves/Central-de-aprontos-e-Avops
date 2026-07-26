export type SheetKind = 'EFETIVO' | 'AVOPS' | 'LEITURAS' | 'APRONTOS' | 'PRESENCAS';

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
