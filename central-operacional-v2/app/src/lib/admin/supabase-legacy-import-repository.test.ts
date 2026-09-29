import { describe, expect, it, vi } from 'vitest';
import { SupabaseLegacyImportRepository } from './supabase-legacy-import-repository';

vi.mock('server-only', () => ({}));

describe('SupabaseLegacyImportRepository', () => {
  it('aceita a resposta idempotente sem exigir uma nova auditoria', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        already_applied: true,
        batch_id: '00000000-0000-4000-8000-000000000001',
        applied_records: 405,
      },
      error: null,
    });
    const repository = new SupabaseLegacyImportRepository({ rpc } as never);

    await expect(repository.applyBatch({
      actorProfileId: '00000000-0000-4000-8000-000000000002',
      batchId: '00000000-0000-4000-8000-000000000001',
      confirmationToken: 'opaque-confirmation-token',
    })).resolves.toEqual({
      ok: true,
      batchId: '00000000-0000-4000-8000-000000000001',
      appliedRecords: 405,
      alreadyApplied: true,
    });
  });

  it('continua exigindo auditoria na primeira aplicação', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        already_applied: false,
        batch_id: '00000000-0000-4000-8000-000000000001',
        applied_records: 405,
      },
      error: null,
    });
    const repository = new SupabaseLegacyImportRepository({ rpc } as never);

    await expect(repository.applyBatch({
      actorProfileId: '00000000-0000-4000-8000-000000000002',
      batchId: '00000000-0000-4000-8000-000000000001',
      confirmationToken: 'opaque-confirmation-token',
    })).resolves.toEqual({ ok: false, reason: 'INTERNAL_ERROR' });
  });
});
