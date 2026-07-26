export type SheetKind = 'EFETIVO' | 'AVOPS' | 'LEITURAS';

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
  operation: 'upsert' | 'link' | 'acknowledge';
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
  issues: ImportIssue[];
  operations: ImportOperation<TPayload>[];
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
