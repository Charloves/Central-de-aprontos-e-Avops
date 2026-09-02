import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import type { ImportOperation, SheetKind } from '@/lib/importers/types';
import type {
  LegacyImportApplyResult,
  LegacyImportBatchSummary,
  LegacyImportReferenceSnapshot,
  LegacyImportRepository,
  SanitizedImportReport,
} from './legacy-imports';
import { confirmationTokenHash } from './legacy-imports';

type ReferenceProfileRow = {
  trigram: string;
  profile_roles: Array<{ role: string }> | null;
};

type BatchRow = {
  id: string;
  source_file_name: string | null;
  source_file_hash: string;
  validation_fingerprint: string | null;
  status: LegacyImportBatchSummary['status'];
  result_summary: SanitizedImportReport | null;
  metadata: { report?: SanitizedImportReport } | null;
};

type ApplyRpcResult = {
  ok?: boolean;
  already_applied?: boolean;
  batch_id?: string;
  applied_records?: number;
  audit_id?: string;
};

export class SupabaseLegacyImportRepository implements LegacyImportRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async getReferenceSnapshot(): Promise<LegacyImportReferenceSnapshot> {
    const [profiles, avops, briefings, ois, audiences] = await Promise.all([
      this.client
        .from('profiles')
        .select('trigram,profile_roles!profile_roles_profile_id_fkey(role)')
        .returns<ReferenceProfileRow[]>(),
      this.client.from('avops').select('number').returns<Array<{ number: string }>>(),
      this.client.from('briefings').select('legacy_id').returns<Array<{ legacy_id: string | null }>>(),
      this.client.from('ois').select('aircraft,oi_key').returns<Array<{ aircraft: string; oi_key: string }>>(),
      this.client.from('audiences').select('code').eq('active', true).returns<Array<{ code: string }>>(),
    ]);

    for (const result of [profiles, avops, briefings, ois, audiences]) {
      if (result.error) throw result.error;
    }

    const profileRows = profiles.data ?? [];
    return {
      trigrams: profileRows.map((row) => row.trigram),
      adminTrigrams: profileRows
        .filter((row) => row.profile_roles?.some((role) => role.role === 'ADMIN'))
        .map((row) => row.trigram),
      avopNumbers: (avops.data ?? []).map((row) => row.number),
      briefingLegacyIds: (briefings.data ?? []).map((row) => row.legacy_id).filter((value): value is string => Boolean(value)),
      oiKeys: (ois.data ?? []).map((row) => `${row.aircraft}|${row.oi_key}`),
      audienceCodes: (audiences.data ?? []).map((row) => row.code),
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
    now?: Date;
  }): Promise<LegacyImportBatchSummary> {
    const now = (input.now ?? new Date()).toISOString();
    const existing = await this.client
      .from('historical_import_batches')
      .select('id,source_file_name,source_file_hash,validation_fingerprint,status,result_summary,metadata')
      .eq('source', 'CENTRAL_LEGACY_ADMIN')
      .eq('source_reference', input.kind)
      .eq('source_file_hash', input.sourceFileHash)
      .maybeSingle<BatchRow>();

    if (existing.error) throw existing.error;

    const batchWrite = {
      source_file_name: input.fileName,
      record_type: input.kind,
      dry_run: true,
      migrated: false,
      status: 'VALIDATED',
      validation_fingerprint: input.validationFingerprint,
      confirmation_token_hash: input.confirmationTokenHash,
      confirmed_at: now,
      metadata: { report: input.report },
      created_by: input.actorProfileId,
      updated_at: now,
    };

    const { data: batch, error: batchError } = existing.data
      ? await this.client
        .from('historical_import_batches')
        .update(batchWrite)
        .eq('id', existing.data.id)
        .neq('status', 'APPLIED')
        .select('id,source_file_name,source_file_hash,validation_fingerprint,status,result_summary,metadata')
        .single<BatchRow>()
      : await this.client
        .from('historical_import_batches')
        .insert({
          source: 'CENTRAL_LEGACY_ADMIN',
          source_reference: input.kind,
          source_file_hash: input.sourceFileHash,
          ...batchWrite,
        })
        .select('id,source_file_name,source_file_hash,validation_fingerprint,status,result_summary,metadata')
        .single<BatchRow>();

    if (batchError) throw batchError;

    const batchId = batch.id;
    const rows = input.operations.map((operation) => {
      const classification = operation.operation === 'stage'
        ? String(operation.payload.classification ?? 'invalid')
        : 'valid';
      return {
        batch_id: batchId,
        source: 'CENTRAL_LEGACY_ADMIN',
        source_record_type: operation.sheet,
        source_row_number: typeof operation.payload.rowNumber === 'number' ? operation.payload.rowNumber : null,
        idempotency_key: operation.idempotencyKey,
        original_content: operation.original,
        normalized_content: operation.operation === 'stage' ? operation.payload.normalized ?? operation.payload : operation.payload,
        classification,
        issues: operation.operation === 'stage' ? operation.payload.issues ?? [] : [],
        limitation_reason: operation.operation === 'stage'
          ? String(operation.payload.limitationReason ?? 'registro legado exige resolução antes da aplicação definitiva')
          : null,
        migrated: false,
        created_by: input.actorProfileId,
        updated_at: now,
      };
    });

    if (rows.length) {
      const { error: stagingError } = await this.client
        .from('historical_import_staging_records')
        .upsert(rows, { onConflict: 'batch_id,idempotency_key' });
      if (stagingError) throw stagingError;
    }

    return mapBatch(batch);
  }

  async findBatch(batchId: string): Promise<LegacyImportBatchSummary | null> {
    const { data, error } = await this.client
      .from('historical_import_batches')
      .select('id,source_file_name,source_file_hash,validation_fingerprint,status,result_summary,metadata')
      .eq('id', batchId)
      .maybeSingle<BatchRow>();
    if (error) throw error;
    return data ? mapBatch(data) : null;
  }

  async applyBatch(input: {
    actorProfileId: string;
    batchId: string;
    confirmationToken: string;
    now?: Date;
  }): Promise<LegacyImportApplyResult> {
    const { data, error } = await this.client.rpc('admin_apply_legacy_import_batch', {
      p_actor_profile_id: input.actorProfileId,
      p_batch_id: input.batchId,
      p_confirmation_token_hash: confirmationTokenHash(input.confirmationToken),
      p_now: (input.now ?? new Date()).toISOString(),
    });

    if (error) return mapRpcError(error.code);
    const result = data as ApplyRpcResult | null;
    if (!result?.ok || !result.batch_id || !result.audit_id) return { ok: false, reason: 'INTERNAL_ERROR' };
    return {
      ok: true,
      batchId: result.batch_id,
      appliedRecords: result.applied_records ?? 0,
      auditId: result.audit_id,
      alreadyApplied: result.already_applied === true,
    };
  }

  async cancelBatch(input: { actorProfileId: string; batchId: string; now?: Date }): Promise<LegacyImportApplyResult> {
    const { data, error } = await this.client
      .from('historical_import_batches')
      .update({
        status: 'CANCELED',
        canceled_at: (input.now ?? new Date()).toISOString(),
        canceled_by: input.actorProfileId,
      })
      .eq('id', input.batchId)
      .eq('status', 'VALIDATED')
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error) return { ok: false, reason: 'INTERNAL_ERROR' };
    if (!data) return { ok: false, reason: 'NOT_READY' };
    return { ok: true, batchId: data.id, appliedRecords: 0, auditId: 'not-audited' };
  }
}

function mapBatch(row: BatchRow): LegacyImportBatchSummary {
  const metadataReport = row.metadata?.report;
  return {
    batchId: row.id,
    sourceFileName: row.source_file_name ?? 'arquivo-legado',
    sourceFileHash: row.source_file_hash,
    validationFingerprint: row.validation_fingerprint ?? '',
    status: row.status,
    report: metadataReport ?? emptyReport(),
  };
}

function mapRpcError(code: string | undefined): LegacyImportApplyResult {
  if (code === '42501') return { ok: false, reason: 'FORBIDDEN' };
  if (code === '02000') return { ok: false, reason: 'NOT_FOUND' };
  if (code === '22023') return { ok: false, reason: 'NOT_READY' };
  return { ok: false, reason: 'INTERNAL_ERROR' };
}

function emptyReport(): SanitizedImportReport {
  return {
    dryRun: true,
    generatedAt: new Date(0).toISOString(),
    canApply: false,
    issuesByCategory: {},
    sheets: [],
    totals: {
      read: 0,
      valid: 0,
      invalid: 0,
      duplicates: 0,
      normalized: 0,
      operations: 0,
      metrics: {},
    },
  };
}
