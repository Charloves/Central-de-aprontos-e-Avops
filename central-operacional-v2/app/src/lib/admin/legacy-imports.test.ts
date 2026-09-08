import { describe, expect, it } from 'vitest';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import { FakeLegacyImportRepository } from './fake-legacy-import-repository';
import {
  applyLegacyImportForSession,
  classifyAgainstReferences,
  createLegacyImportPreviewForSession,
  decodeConfirmationCookie,
  encodeConfirmationCookie,
  parseImportRows,
  sanitizeImportReport,
  validateLegacyImportFile,
} from './legacy-imports';
import { parseEfetivo, parseLeituras, parsePresencas } from '@/lib/importers';

const adminSession = session(['USER', 'COORDINATOR', 'ADMIN']);
const userSession = session(['USER']);

describe('legacy import administration', () => {
  it('blocks common users from creating a preview', async () => {
    const result = await createLegacyImportPreviewForSession({
      session: userSession,
      formData: formWithFile('EFETIVO', 'ID,NOME,ATIVO\nABC,Militar Fictício,SIM\n'),
      repository: new FakeLegacyImportRepository(),
    });

    expect(result).toEqual({ ok: false, reason: 'FORBIDDEN' });
  });

  it('derives the actor from the session and rejects client supplied identity', async () => {
    const formData = formWithFile('EFETIVO', 'ID,NOME,ATIVO\nABC,Militar Fictício,SIM\n');
    formData.set('actor_profile_id', '00000000-0000-4000-8000-000000000999');

    const result = await createLegacyImportPreviewForSession({
      session: adminSession,
      formData,
      repository: new FakeLegacyImportRepository(),
    });

    expect(result).toEqual({ ok: false, reason: 'INVALID_INPUT' });
  });

  it('rejects unsupported extension and oversized file', () => {
    expect(validateLegacyImportFile(file('legado.xlsx', 'fake'))).toEqual({ ok: false, reason: 'INVALID_EXTENSION' });
    expect(validateLegacyImportFile(new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'legado.csv'))).toEqual({
      ok: false,
      reason: 'INVALID_SIZE',
    });
  });

  it('rejects malformed files without exposing parsed content', async () => {
    const result = await createLegacyImportPreviewForSession({
      session: adminSession,
      formData: formWithNamedFile('EFETIVO', 'legado.json', '{"ID":"ABC"}'),
      repository: new FakeLegacyImportRepository(),
    });

    expect(result).toEqual({ ok: false, reason: 'INTERNAL_ERROR' });
  });

  it('parses CSV without executing formula-like content', () => {
    const rows = parseImportRows('efetivo.csv', 'ID,NOME,ATIVO\nABC,=cmd|malicioso,SIM\n');
    const classified = classifyAgainstReferences(parseEfetivo(rows), emptyReference());
    const report = sanitizeImportReport(classified, { generatedAt: '2026-09-02T00:00:00.000Z' });

    expect(classified.issues.map((issue) => issue.code)).toContain('CSV_FORMULA_INJECTION');
    expect(report.canApply).toBe(false);
    expect(report.sheets[0].operations[0].sample.name).toBe('[REDACTED]');
    expect(JSON.stringify(report)).not.toContain('cmd|malicioso');
  });

  it('classifies duplicates inside the file and against the database', () => {
    const parsed = parseEfetivo(parseImportRows('efetivo.csv', 'ID,NOME,ATIVO\nABC,Militar Um,SIM\nABC,Militar Dois,SIM\nCHA,Chefe,SIM\n'));
    const classified = classifyAgainstReferences(parsed, {
      trigrams: ['CHA'],
      adminTrigrams: ['CHA'],
      avopNumbers: [],
      briefingLegacyIds: [],
      oiKeys: [],
      audienceCodes: ['TODOS'],
    });

    expect(classified.duplicates).toBeGreaterThan(0);
    expect(classified.issues.map((issue) => issue.code)).toContain('ADMIN_PROFILE_PROTECTED');
  });

  it('detects missing references and ambiguous presence rows', () => {
    const leitura = classifyAgainstReferences(parseLeituras(parseImportRows('leituras.csv', 'AVOP_ID,ID\nAVOP 01-2026,ABC\n')), emptyReference());
    const presenca = classifyAgainstReferences(parsePresencas(parseImportRows('presencas.csv', 'APRONTO_ID,ID,STATUS\nAPR-2026-001,ABC,\n')), emptyReference());

    expect(leitura.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['MISSING_PROFILE_REFERENCE', 'MISSING_AVOP_REFERENCE']));
    expect(presenca.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['MISSING_PROFILE_REFERENCE', 'MISSING_BRIEFING_REFERENCE', 'AMBIGUOUS_EMPTY_RECORD']));
  });

  it('creates a confirmed preview batch without operational writes', async () => {
    const repository = new FakeLegacyImportRepository();
    const result = await createLegacyImportPreviewForSession({
      session: adminSession,
      formData: formWithFile('EFETIVO', 'ID,NOME,ATIVO,PERFIS\nABC,Militar Fictício,SIM,TODOS\n'),
      repository,
    });

    expect(result.ok).toBe(true);
    expect(repository.operationalWrites).toBe(0);
    if (result.ok) expect(result.batch.report.canApply).toBe(true);
  });

  it('binds application to the server confirmation token', async () => {
    const repository = new FakeLegacyImportRepository();
    const preview = await createLegacyImportPreviewForSession({
      session: adminSession,
      formData: formWithFile('EFETIVO', 'ID,NOME,ATIVO,PERFIS\nABC,Militar Fictício,SIM,TODOS\n'),
      repository,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const cookie = encodeConfirmationCookie(preview.batch.batchId, preview.batch.confirmationToken ?? '');
    const validToken = decodeConfirmationCookie(cookie, preview.batch.batchId);
    const invalidToken = decodeConfirmationCookie(cookie, '00000000-0000-4000-8000-000000000999');

    expect(validToken).toBe(preview.batch.confirmationToken);
    expect(invalidToken).toBeUndefined();
  });

  it('applies once and treats repeated application as idempotent', async () => {
    const repository = new FakeLegacyImportRepository();
    const preview = await createLegacyImportPreviewForSession({
      session: adminSession,
      formData: formWithFile('EFETIVO', 'ID,NOME,ATIVO,PERFIS\nABC,Militar Fictício,SIM,TODOS\n'),
      repository,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const formData = new FormData();
    formData.set('batchId', preview.batch.batchId);
    const first = await applyLegacyImportForSession({
      session: adminSession,
      formData,
      confirmationToken: preview.batch.confirmationToken,
      repository,
    });
    const second = await applyLegacyImportForSession({
      session: adminSession,
      formData,
      confirmationToken: preview.batch.confirmationToken,
      repository,
    });

    expect(first).toMatchObject({ ok: true, appliedRecords: 1 });
    expect(second).toMatchObject({ ok: true, alreadyApplied: true });
    expect(repository.operationalWrites).toBe(1);
  });

  it('keeps a single operational application under concurrent confirmation', async () => {
    const repository = new FakeLegacyImportRepository();
    const preview = await createLegacyImportPreviewForSession({
      session: adminSession,
      formData: formWithFile('EFETIVO', 'ID,NOME,ATIVO,PERFIS\nABC,Militar Fictício,SIM,TODOS\n'),
      repository,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const formData = new FormData();
    formData.set('batchId', preview.batch.batchId);
    const [first, second] = await Promise.all([
      applyLegacyImportForSession({ session: adminSession, formData, confirmationToken: preview.batch.confirmationToken, repository }),
      applyLegacyImportForSession({ session: adminSession, formData, confirmationToken: preview.batch.confirmationToken, repository }),
    ]);

    expect([first, second].filter((result) => result.ok && !result.alreadyApplied)).toHaveLength(1);
    expect(repository.operationalWrites).toBe(1);
  });

  it('rejects token tampering between preview and confirmation', async () => {
    const repository = new FakeLegacyImportRepository();
    const preview = await createLegacyImportPreviewForSession({
      session: adminSession,
      formData: formWithFile('EFETIVO', 'ID,NOME,ATIVO,PERFIS\nABC,Militar Fictício,SIM,TODOS\n'),
      repository,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const formData = new FormData();
    formData.set('batchId', preview.batch.batchId);
    await expect(applyLegacyImportForSession({
      session: adminSession,
      formData,
      confirmationToken: 'tampered',
      repository,
    })).resolves.toEqual({ ok: false, reason: 'FORBIDDEN' });
  });

  it('keeps reports free of sensitive values', async () => {
    const result = await createLegacyImportPreviewForSession({
      session: adminSession,
      formData: formWithFile('EFETIVO', 'ID,NOME,EMAIL,ATIVO\nABC,Nome Sensível,pessoa@example.test,SIM\n'),
      repository: new FakeLegacyImportRepository(),
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Nome Sensível');
    expect(JSON.stringify(result)).not.toContain('pessoa@example.test');
  });
});

function formWithFile(kind: string, content: string): FormData {
  return formWithNamedFile(kind, 'legado.csv', content);
}

function formWithNamedFile(kind: string, name: string, content: string): FormData {
  const formData = new FormData();
  formData.set('kind', kind);
  formData.set('file', file(name, content));
  return formData;
}

function file(name: string, content: string): File {
  return new File([content], name, { type: name.endsWith('.json') ? 'application/json' : 'text/csv' });
}

function session(roles: AuthenticatedSession['roles']): AuthenticatedSession {
  return {
    profileId: '00000000-0000-4000-8000-000000000001',
    trigram: 'CHA',
    roles,
    sessionIdentifier: 'opaque-session-token-for-tests-000000000000000',
  };
}

function emptyReference() {
  return {
    trigrams: [],
    adminTrigrams: [],
    avopNumbers: [],
    briefingLegacyIds: [],
    oiKeys: [],
    audienceCodes: ['PILOTO', 'TRIPULANTE', 'HSAR', 'TODOS'],
  };
}
