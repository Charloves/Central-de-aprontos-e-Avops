import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseAvops, parseEfetivo, parseLeituras } from './legacy';
import { buildImportReport } from './report';

describe('legacy importers', () => {
  it('parseia CSV preservando valores com virgula entre aspas', () => {
    const rows = parseCsv('ID,NOME,PERFIS\nabc,"Militar, Teste","PILOTO E TRIPULANTES"\n');
    expect(rows).toEqual([{ ID: 'abc', NOME: 'Militar, Teste', PERFIS: 'PILOTO E TRIPULANTES' }]);
  });

  it('parseia CSV preservando quebra de linha dentro de campo entre aspas', () => {
    const rows = parseCsv('ID,NOME,OBS\nabc,Militar Alfa,"linha 1\nlinha 2"\n');
    expect(rows).toEqual([{ ID: 'abc', NOME: 'Militar Alfa', OBS: 'linha 1\nlinha 2' }]);
  });

  it('normaliza efetivo e aponta duplicados sem interromper tudo', () => {
    const result = parseEfetivo([
      { ID: ' abc ', NOME: 'Militar Alfa', EMAIL: 'alfa@example.test', ATIVO: 'SIM', PERFIS: 'PILOTO E TRIPULANTES' },
      { ID: 'ABC', NOME: 'Duplicado', EMAIL: 'duplicado@example.test', ATIVO: 'SIM', PERFIS: 'PILOTO' },
      { ID: '', NOME: 'Sem ID', EMAIL: 'sem-id@example.test', ATIVO: 'SIM', PERFIS: 'PILOTO' },
    ]);

    expect(result).toMatchObject({ read: 3, valid: 1, invalid: 1, duplicates: 1, normalized: 1 });
    expect(result.operations[0].idempotencyKey).toBe('profile:ABC');
    expect(result.issues.map((issue) => issue.code)).toEqual(['DUPLICATE_ROW', 'MISSING_VALUE']);
  });

  it('normaliza AVOP legado e prepara upsert idempotente', () => {
    const result = parseAvops([
      {
        AVOP_ID: 'AVOP-2026-01',
        TITULO: 'Procedimento ficticio',
        DATA_EMISSAO: '22/04/2026',
        STATUS: 'ATIVO',
        PERFIL_ALVO: 'PILOTO E HSAR',
        EXIGE_CIENCIA: 'SIM',
      },
    ]);

    expect(result).toMatchObject({ valid: 1, normalized: 1 });
    expect(result.operations[0]).toMatchObject({
      operation: 'upsert',
      idempotencyKey: 'avop:AVOP 01-2026',
      payload: {
        number: 'AVOP 01-2026',
        publicationDate: '2026-04-22',
        targetAudiences: ['PILOTO', 'HSAR'],
      },
    });
  });

  it('emite warning nao fatal para publico desconhecido preservado', () => {
    const result = parseEfetivo([
      { ID: 'abc', NOME: 'Militar Alfa', EMAIL: 'alfa@example.test', ATIVO: 'SIM', PERFIS: 'PILOTO E MECANICO' },
    ]);

    expect(result).toMatchObject({ valid: 1, invalid: 0 });
    expect(result.operations[0].payload.audiences).toEqual(['PILOTO', 'MECANICO']);
    expect(result.issues).toMatchObject([{ severity: 'warning', code: 'UNKNOWN_AUDIENCE' }]);
  });

  it.each([
    ['22/04/2026', '2026-04-22'],
    ['2026-04-22', '2026-04-22'],
    ['2026-04-22T23:30:00+03:00', '2026-04-22'],
    ['2026-04-22T00:30:00-03:00', '2026-04-22'],
  ])('normaliza data sem deslocar dia: %s', (input, expected) => {
    const result = parseAvops([
      {
        AVOP_ID: 'AVOP 01-2026',
        TITULO: 'Procedimento ficticio',
        DATA_EMISSAO: input,
        STATUS: 'ATIVO',
        PERFIL_ALVO: 'PILOTO',
        EXIGE_CIENCIA: 'SIM',
      },
    ]);

    expect(result.operations[0].payload.publicationDate).toBe(expected);
  });

  it('rejeita data invalida', () => {
    const result = parseAvops([
      {
        AVOP_ID: 'AVOP 01-2026',
        TITULO: 'Procedimento ficticio',
        DATA_EMISSAO: '31/02/2026',
        STATUS: 'ATIVO',
        PERFIL_ALVO: 'PILOTO',
        EXIGE_CIENCIA: 'SIM',
      },
    ]);

    expect(result).toMatchObject({ valid: 0, invalid: 1 });
    expect(result.issues).toMatchObject([{ code: 'MISSING_VALUE' }]);
  });

  it('normaliza leituras e detecta duplicidade por AVOP e trigrama', () => {
    const result = parseLeituras([
      { AVOP_ID: 'AVOP-2026-01', ID: 'abc', DATA: '23/04/2026' },
      { AVOP_ID: 'AVOP 01-2026', ID: 'ABC', DATA: '2026-04-24' },
    ]);

    expect(result).toMatchObject({ read: 2, valid: 1, invalid: 0, duplicates: 1, normalized: 1 });
    expect(result.operations[0].idempotencyKey).toBe('ack:AVOP 01-2026:ABC');
  });

  it('agrega relatorio em modo dry-run', () => {
    const report = buildImportReport([
      parseEfetivo([{ ID: 'abc', NOME: 'Militar Alfa', ATIVO: 'SIM', PERFIS: 'PILOTO' }]),
      parseAvops([
        {
          AVOP_ID: 'AVOP 01-2026',
          TITULO: 'Procedimento ficticio',
          DATA_EMISSAO: '2026-04-22',
          STATUS: 'ATIVO',
          PERFIL_ALVO: 'PILOTO',
          EXIGE_CIENCIA: 'SIM',
        },
      ]),
    ]);

    expect(report.dryRun).toBe(true);
    expect(report.totals).toMatchObject({ read: 2, valid: 2, invalid: 0, operations: 2 });
  });

  it('redact oculta nome e email sem remover chaves operacionais', () => {
    const sheet = parseEfetivo([{ ID: 'abc', NOME: 'Militar Alfa', EMAIL: 'alfa@example.test', ATIVO: 'SIM', PERFIS: 'PILOTO' }]);
    const report = buildImportReport([sheet], '2026-01-01T00:00:00.000Z', { redact: true });
    const text = JSON.stringify(report);

    expect(text).not.toContain('Militar Alfa');
    expect(text).not.toContain('alfa@example.test');
    expect(text).toContain('profile:ABC');
    expect(text).toContain('[REDACTED]');
  });
});
