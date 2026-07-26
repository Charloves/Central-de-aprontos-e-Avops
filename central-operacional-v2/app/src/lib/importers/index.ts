export { readRowsFromFile } from './files.ts';
export { parseAvops, parseEfetivo, parseLeituras } from './legacy.ts';
export { buildImportReport } from './report.ts';
export type {
  AvopPayload,
  EfetivoPayload,
  ImportIssue,
  ImportOperation,
  ImportReport,
  LeituraPayload,
  RawRow,
  SheetImportResult,
  SheetKind,
  SourceFormat,
} from './types.ts';
