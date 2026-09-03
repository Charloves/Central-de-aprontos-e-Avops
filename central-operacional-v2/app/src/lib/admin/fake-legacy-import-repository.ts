import { confirmationTokenHash, type LegacyImportApplyResult, type LegacyImportBatchSummary, type LegacyImportReferenceSnapshot, type LegacyImportRepository, type SanitizedImportReport } from './legacy-imports';
import type { ImportOperation, SheetKind } from '@/lib/importers/types';

type StoredBatch = LegacyImportBatchSummary & {
  actorProfileId: string;
  confirmationTokenHash: string;
  operations: Array<ImportOperation<Record<string, unknown>>>;
};

export class FakeLegacyImportRepository implements LegacyImportRepository {
  public operationalWrites = 0;
  public auditEvents: Array<{ actorProfileId: string; action: string; batchId: string }> = [];
  private batches = new Map<string, StoredBatch>();

  constructor(private readonly reference: LegacyImportReferenceSnapshot = emptyReference()) {}

  async getReferenceSnapshot(): Promise<LegacyImportReferenceSnapshot> {
    return {
      trigrams: [...this.reference.trigrams],
      adminTrigrams: [...this.reference.adminTrigrams],
      avopNumbers: [...this.reference.avopNumbers],
      briefingLegacyIds: [...this.reference.briefingLegacyIds],
      oiKeys: [...this.reference.oiKeys],
      audienceCodes: [...this.reference.audienceCodes],
    };
  }

  async createPreviewBatch(input: {
    actorProfileId: string;
    kind: SheetKind;
    fileName: string;
    sourceFileHash: string;
    validationFingerprint: string;
    confirmationTokenHash: string;
    report: SanitizedImportReport;
    operations: Array<ImportOperation<Record<string, unknown>>>;
  }): Promise<LegacyImportBatchSummary> {
    const batchId = `00000000-0000-4000-8000-${(this.batches.size + 1).toString().padStart(12, '0')}`;
    const batch: StoredBatch = {
      batchId,
      actorProfileId: input.actorProfileId,
      sourceFileName: input.fileName,
      sourceFileHash: input.sourceFileHash,
      validationFingerprint: input.validationFingerprint,
      confirmationTokenHash: input.confirmationTokenHash,
      status: 'VALIDATED',
      report: input.report,
      operations: input.operations,
    };
    this.batches.set(batchId, batch);
    return cloneBatch(batch);
  }

  async findBatch(batchId: string): Promise<LegacyImportBatchSummary | null> {
    const batch = this.batches.get(batchId);
    return batch ? cloneBatch(batch) : null;
  }

  async applyBatch(input: {
    actorProfileId: string;
    batchId: string;
    confirmationToken: string;
  }): Promise<LegacyImportApplyResult> {
    const batch = this.batches.get(input.batchId);
    if (!batch) return { ok: false, reason: 'NOT_FOUND' };
    if (batch.status === 'APPLIED') {
      return { ok: true, batchId: batch.batchId, appliedRecords: 0, auditId: 'audit-existing', alreadyApplied: true };
    }
    if (batch.status !== 'VALIDATED' || !batch.report.canApply) return { ok: false, reason: 'NOT_READY' };
    if (batch.confirmationTokenHash !== confirmationTokenHash(input.confirmationToken)) return { ok: false, reason: 'FORBIDDEN' };

    batch.status = 'APPLIED';
    this.operationalWrites += batch.operations.length;
    this.auditEvents.push({ actorProfileId: input.actorProfileId, action: 'LEGACY_IMPORT_APPLIED', batchId: batch.batchId });
    return { ok: true, batchId: batch.batchId, appliedRecords: batch.operations.length, auditId: `audit-${this.auditEvents.length}` };
  }

  async cancelBatch(input: { actorProfileId: string; batchId: string }): Promise<LegacyImportApplyResult> {
    const batch = this.batches.get(input.batchId);
    if (!batch) return { ok: false, reason: 'NOT_FOUND' };
    if (batch.status === 'APPLIED') return { ok: false, reason: 'NOT_READY' };
    batch.status = 'CANCELED';
    this.auditEvents.push({ actorProfileId: input.actorProfileId, action: 'LEGACY_IMPORT_CANCELED', batchId: batch.batchId });
    return { ok: true, batchId: batch.batchId, appliedRecords: 0, auditId: `audit-${this.auditEvents.length}` };
  }
}

function cloneBatch(batch: StoredBatch): LegacyImportBatchSummary {
  return {
    batchId: batch.batchId,
    sourceFileName: batch.sourceFileName,
    sourceFileHash: batch.sourceFileHash,
    validationFingerprint: batch.validationFingerprint,
    status: batch.status,
    report: JSON.parse(JSON.stringify(batch.report)) as SanitizedImportReport,
  };
}

function emptyReference(): LegacyImportReferenceSnapshot {
  return {
    trigrams: [],
    adminTrigrams: [],
    avopNumbers: [],
    briefingLegacyIds: [],
    oiKeys: [],
    audienceCodes: ['PILOTO', 'TRIPULANTE', 'HSAR', 'TODOS'],
  };
}
