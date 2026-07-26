import type { ImportReport, SheetImportResult } from './types.ts';

type ReportOptions = {
  redact?: boolean;
};

export function buildImportReport(
  sheets: Array<SheetImportResult<Record<string, unknown>>>,
  generatedAt = new Date().toISOString(),
  options: ReportOptions = {},
): ImportReport {
  const outputSheets = options.redact ? sheets.map(redactSheet) : sheets;

  return {
    dryRun: true,
    generatedAt,
    sheets: outputSheets,
    totals: outputSheets.reduce(
      (totals, sheet) => ({
        read: totals.read + sheet.read,
        valid: totals.valid + sheet.valid,
        invalid: totals.invalid + sheet.invalid,
        duplicates: totals.duplicates + sheet.duplicates,
        normalized: totals.normalized + sheet.normalized,
        operations: totals.operations + sheet.operations.length,
      }),
      { read: 0, valid: 0, invalid: 0, duplicates: 0, normalized: 0, operations: 0 },
    ),
  };
}

function redactSheet(sheet: SheetImportResult<Record<string, unknown>>): SheetImportResult<Record<string, unknown>> {
  return {
    ...sheet,
    issues: sheet.issues.map((issue) => ({ ...issue, raw: redactRow(issue.raw) })),
    operations: sheet.operations.map((operation) => ({
      ...operation,
      payload: redactRow(operation.payload),
      original: redactRow(operation.original),
    })),
  };
}

function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (isSensitiveReportField(key)) return [key, value ? '[REDACTED]' : value];
      return [key, value];
    }),
  );
}

function isSensitiveReportField(key: string): boolean {
  const normalized = key.toUpperCase();
  return normalized === 'NOME' || normalized === 'EMAIL' || normalized === 'NAME';
}
