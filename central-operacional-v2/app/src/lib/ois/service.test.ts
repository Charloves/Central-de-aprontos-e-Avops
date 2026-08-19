import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import type { OiRecord } from '@/lib/domain/types';
import { FakeOiRepository } from './fake-oi-repository';
import { formatPageRange, isValidOiDocumentUrl, normalizeOiAircraft, validateOiQuery } from './rules';
import { searchOiForSession } from './service';

vi.mock('server-only', () => ({}));

const session: AuthenticatedSession = {
  sessionIdentifier: 'opaque-session-token-oi-test-000000000001',
  profileId: 'profile-1',
  persistentSessionId: 'persistent-session-id-oi',
  trigram: 'CHA',
  roles: ['USER'],
};

const records: OiRecord[] = [
  oi({
    aircraft: 'H50',
    oiKey: 'PESOP|SPFO-1|01HE01|ADAPTACAO_DIURNA',
    title: 'Adaptacao diurna',
    phaseId: '01HE01',
    displayKey: '01HE01 - Adaptacao diurna',
    missionCodes: ['01HE01D01', '01HE01D18'],
    startPage: 10,
    endPage: 12,
    driveUrl: 'https://drive.google.com/file/d/fase-h50/view',
    driveFileId: 'fase-h50',
  }),
  oi({
    aircraft: 'H50',
    oiKey: 'PESOP|SPFO-1|01HE01|ADAPTACAO_DIURNA_AVANCADA',
    title: 'Adaptacao diurna avancada',
    phaseId: '01HE01',
    displayKey: '01HE01 - Adaptacao diurna avancada',
    missionCodes: ['01HE01D20'],
    startPage: 13,
    endPage: 15,
    driveFileId: 'fase-h50-b',
  }),
  oi({
    aircraft: 'H125',
    oiKey: 'PESOP|SPHA-1|01HE01|ADAPTACAO_DIURNA',
    title: 'Adaptacao diurna H125',
    phaseId: '01HE01',
    displayKey: '01HE01 - Adaptacao diurna H125',
    missionCodes: ['01HE01D01'],
    startPage: 20,
    endPage: 22,
    driveFileId: 'fase-h125',
  }),
  oi({
    aircraft: 'H50',
    oiKey: 'PESOP|SPFO-2|02HE02|SEM_MISSOES',
    title: 'Fase sem lista de missoes',
    phaseId: '02HE02',
    displayKey: '02HE02 - Sem missoes',
    missionCodes: [],
    startPage: 30,
    endPage: null,
    driveFileId: 'sem-missoes',
  }),
  oi({
    aircraft: 'H50',
    oiKey: 'PESOP|SPFO-3|03HE03|INATIVA',
    title: 'Fase inativa',
    phaseId: '03HE03',
    displayKey: '03HE03 - Inativa',
    missionCodes: ['03HE03D01'],
    active: false,
    driveFileId: 'inativa',
  }),
  oi({
    aircraft: 'H50',
    oiKey: 'PESOP|SPFO-4|04HE04|LINK_INVALIDO',
    title: 'Link invalido',
    phaseId: '04HE04',
    displayKey: '04HE04 - Link invalido',
    missionCodes: ['04HE04D01'],
    driveUrl: 'http://drive.google.com/file/d/invalido/view',
    driveFileId: 'invalido',
  }),
];

describe('OI module service', () => {
  it('exige sessao valida e nao consulta sem usuario autenticado', async () => {
    const repository = new FakeOiRepository(records);

    await expect(searchOiForSession({ session: null, repository, aircraft: 'H50', query: '01HE01D01' })).resolves.toEqual({
      ok: false,
      reason: 'UNAUTHORIZED',
      items: [],
    });
    expect(repository.listCalls).toBe(0);
  });

  it('normaliza aeronave, espacos e caixa sem misturar H-50 e H-125', async () => {
    const repository = new FakeOiRepository(records);
    const h50 = await searchOiForSession({ session, repository, aircraft: ' h-50 ', query: ' 01he01d01 ' });
    const h125 = await searchOiForSession({ session, repository, aircraft: 'H-125', query: '01HE01D01' });

    expect(h50).toMatchObject({ ok: true, status: 'single' });
    expect(h50.items[0]?.aircraft).toBe('H50');
    expect(h125).toMatchObject({ ok: true, status: 'single' });
    expect(h125.items[0]?.aircraft).toBe('H125');
  });

  it('retorna single, ambiguous, not_found e empty sem escolher resultado arbitrario', async () => {
    const repository = new FakeOiRepository(records);

    await expect(searchOiForSession({ session, repository, aircraft: 'H50', query: '01HE01D18' })).resolves.toMatchObject({ ok: true, status: 'single' });
    await expect(searchOiForSession({ session, repository, aircraft: 'H50', query: '01HE01' })).resolves.toMatchObject({ ok: true, status: 'ambiguous' });
    await expect(searchOiForSession({ session, repository, aircraft: 'H50', query: '99ZZ99D01' })).resolves.toMatchObject({ ok: true, status: 'not_found' });
    await expect(searchOiForSession({ session, repository, aircraft: 'H50', query: '   ' })).resolves.toMatchObject({ ok: true, status: 'empty' });
  });

  it('proibe fallback de codigo completo fora de MISSOES quando a lista existe', async () => {
    const result = await searchOiForSession({
      session,
      repository: new FakeOiRepository(records),
      aircraft: 'H50',
      query: '01HE01D19',
    });

    expect(result).toMatchObject({ ok: true, status: 'not_found' });
  });

  it('permite fallback por fase quando MISSOES estiver vazio', async () => {
    const result = await searchOiForSession({
      session,
      repository: new FakeOiRepository(records),
      aircraft: 'H50',
      query: '02HE02D99',
    });

    expect(result).toMatchObject({ ok: true, status: 'single' });
    expect(result.items[0]?.oiKey).toContain('SEM_MISSOES');
  });

  it('busca por tipo de missao, omite inativas e preserva ordenacao deterministica', async () => {
    const first = await searchOiForSession({ session, repository: new FakeOiRepository(records), aircraft: 'H50', query: 'adaptacao diurna' });
    const second = await searchOiForSession({ session, repository: new FakeOiRepository([...records].reverse()), aircraft: 'H50', query: 'adaptacao diurna' });

    expect(first).toMatchObject({ ok: true, status: 'ambiguous' });
    expect(first.items.map((item) => item.oiKey)).toEqual(second.items.map((item) => item.oiKey));
    expect(first.items.map((item) => item.oiKey)).not.toEqual(expect.arrayContaining([expect.stringContaining('INATIVA')]));
  });

  it('marca link invalido sem escrever nem fazer chamada externa', async () => {
    const repository = new FakeOiRepository(records);
    const result = await searchOiForSession({ session, repository, aircraft: 'H50', query: '04HE04D01' });

    expect(result).toMatchObject({ ok: true, status: 'single' });
    expect(result.items[0]?.documentUrlValid).toBe(false);
    expect(repository.writeCalls).toBe(0);
  });

  it('rejeita entrada excessiva, caracteres invalidos e tentativa de injecao', () => {
    expect(validateOiQuery('01HE01D01')).toEqual({ ok: true, query: '01HE01D01' });
    expect(validateOiQuery('A'.repeat(81))).toEqual({ ok: false, reason: 'invalid' });
    expect(validateOiQuery('01HE01D01; drop table ois')).toEqual({ ok: false, reason: 'invalid' });
    expect(validateOiQuery('<script>alert(1)</script>')).toEqual({ ok: false, reason: 'invalid' });
    expect(validateOiQuery('01HE01D01\nBCC')).toEqual({ ok: false, reason: 'invalid' });
    expect(validateOiQuery('01HE01D01\rBCC')).toEqual({ ok: false, reason: 'invalid' });
    expect(validateOiQuery('01HE01D01\nBcc: x@example.test')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('valida aeronave, links e intervalo de paginas', () => {
    expect(normalizeOiAircraft('H-50')).toBe('H50');
    expect(normalizeOiAircraft('H 125')).toBe('H125');
    expect(normalizeOiAircraft('H-60')).toBeNull();
    expect(isValidOiDocumentUrl('https://drive.google.com/file/d/ficticio/view', 'production')).toBe(true);
    expect(isValidOiDocumentUrl('https://example.test/docs/oi.pdf', 'development')).toBe(true);
    expect(isValidOiDocumentUrl('https://example.test/docs/oi.pdf', 'production')).toBe(false);
    expect(isValidOiDocumentUrl('https://drive.google.com.evil.test/file', 'production')).toBe(false);
    expect(isValidOiDocumentUrl('https://user:pass@drive.google.com/file/d/ficticio/view', 'production')).toBe(false);
    expect(formatPageRange(10, 12)).toBe('Páginas 10 a 12');
    expect(formatPageRange(10, null)).toBe('Página 10');
    expect(formatPageRange(10, 8)).toBe('Página 10');
  });

  it('falha do Supabase nega com seguranca e mensagem generica', async () => {
    await expect(searchOiForSession({
      session,
      repository: new FakeOiRepository(records, { fail: true }),
      aircraft: 'H50',
      query: '01HE01D01',
    })).resolves.toEqual({
      ok: false,
      reason: 'INTERNAL_ERROR',
      aircraft: 'H50',
      query: '01HE01D01',
      items: [],
    });
  });
});

function oi(input: Partial<OiRecord> & Pick<OiRecord, 'aircraft' | 'oiKey' | 'title' | 'phaseId' | 'displayKey' | 'missionCodes'>): OiRecord {
  return {
    program: 'PESOP',
    subprogram: 'SPFO-1',
    driveUrl: 'https://drive.google.com/file/d/ficticio/view',
    driveFileId: 'ficticio',
    startPage: 1,
    endPage: 2,
    active: true,
    ...input,
  };
}
