import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseAprontos, parseAvops, parseEfetivo, parseLeituras, parsePresencas } from './legacy';
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
    expect(result.operations[0].payload).toMatchObject({ audiences: ['PILOTO', 'MECANICO'] });
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

    expect(result.operations[0].payload).toMatchObject({ publicationDate: expected });
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

  it('normaliza apronto valido, fechado e legado', () => {
    const result = parseAprontos([
      {
        APRONTO_ID: 'APR 2026 001',
        TITULO: 'Apronto ficticio aberto',
        DATA: '16/03/2026',
        PERFIL_ALVO: 'PILOTO',
        STATUS: 'ABERTO',
        LINK_MATERIAL: 'https://example.test/apronto-001',
        EXIGE_CIENCIA_MATERIAL: 'SIM',
      },
      {
        APRONTO_ID: 'APR-2026-002',
        TITULO: 'Apronto ficticio fechado',
        DATA: '2026-03-17T23:30:00-03:00',
        PUBLICO: 'TODOS',
        STATUS: 'FECHADO',
        LINK_MATERIAL: '',
        EXIGE_CIENCIA_MATERIAL: 'NAO',
      },
    ]);

    expect(result).toMatchObject({ valid: 2, invalid: 0, normalized: 1 });
    expect(result.metrics).toMatchObject({ aprontos: 2, fechados: 1 });
    expect(result.operations[0]).toMatchObject({
      idempotencyKey: 'briefing:APR-2026-001',
      payload: { briefingId: 'APR-2026-001', eventDate: '2026-03-16', requiresMaterialAcknowledgement: true },
    });
    expect(result.operations[1].payload).toMatchObject({ eventDate: '2026-03-17' });
  });

  it('preserva registro de presenca com campos finais vazios', () => {
    const result = parsePresencas([{ DATA: '16/03/2026', APRONTO_ID: 'APR-2026-001', ID: 'abc', STATUS: 'PRESENTE', OBS: '', CIENCIA_MATERIAL: '', EXTRA: '' }]);

    expect(result).toMatchObject({ valid: 1, invalid: 0 });
    expect(result.operations[0].payload).toMatchObject({
      briefingId: 'APR-2026-001',
      trigram: 'ABC',
      attendanceStatus: 'PRESENTE',
      hasAttendance: true,
      justificationText: null,
      materialAcknowledged: false,
    });
  });

  it('diferencia falta, justificativa e ciencia de material', () => {
    const result = parsePresencas([
      { DATA: '16/03/2026', APRONTO_ID: 'APR-2026-001', ID: 'abc', STATUS: 'AUSENTE', OBS: '', CIENCIA_MATERIAL: '' },
      {
        DATA: '16/03/2026',
        APRONTO_ID: 'APR-2026-001',
        ID: 'def',
        STATUS: 'JUSTIFICADO',
        OBS: 'Texto ficticio de justificativa',
        CIENCIA_MATERIAL: 'SIM',
      },
    ]);

    expect(result).toMatchObject({ valid: 2, invalid: 0 });
    expect(result.metrics).toMatchObject({ presencas: 0, faltas: 2, justificativas: 1, cienciasMaterial: 1 });
    expect(result.operations[1].payload).toMatchObject({
      hasAbsence: true,
      justificationText: 'Texto ficticio de justificativa',
      materialAcknowledged: true,
    });
  });

  it('preserva primeiro registro valido em duplicidade por apronto e trigrama', () => {
    const result = parsePresencas([
      { DATA: '16/03/2026', APRONTO_ID: 'APR-2026-001', ID: 'abc', STATUS: 'PRESENTE', OBS: '', CIENCIA_MATERIAL: '' },
      { DATA: '17/03/2026', APRONTO_ID: 'APR 2026 001', ID: 'ABC', STATUS: 'JUSTIFICADO', OBS: 'Duplicado ficticio', CIENCIA_MATERIAL: 'SIM' },
    ]);

    expect(result).toMatchObject({ valid: 1, duplicates: 1 });
    expect(result.operations[0].payload).toMatchObject({ attendanceStatus: 'PRESENTE' });
    expect(result.operations[0].idempotencyKey).toBe('briefing-record:APR-2026-001:ABC');
    expect(result.operations[1]).toMatchObject({
      operation: 'stage',
      idempotencyKey: 'staging:PRESENCAS:duplicate:3:APR-2026-001|ABC',
      payload: { classification: 'duplicate' },
    });
  });

  it.each([
    ['16/03/2026', '2026-03-16'],
    ['2026-03-16', '2026-03-16'],
    ['2026-03-16T23:30:00+03:00', '2026-03-16'],
    ['2026-03-16T00:30:00-03:00', '2026-03-16'],
  ])('normaliza data de presenca sem deslocar dia: %s', (input, expected) => {
    const result = parsePresencas([{ DATA: input, APRONTO_ID: 'APR-2026-001', ID: 'abc', STATUS: 'PRESENTE' }]);
    expect(result.operations[0].payload).toMatchObject({ recordedAt: expected });
  });

  it('emite warning para registro ambiguo sem inventar classificacao', () => {
    const result = parsePresencas([{ DATA: '16/03/2026', APRONTO_ID: 'APR-2026-001', ID: 'abc', STATUS: '', OBS: '', CIENCIA_MATERIAL: '' }]);

    expect(result).toMatchObject({ valid: 1, invalid: 0 });
    expect(result.operations[0]).toMatchObject({
      operation: 'stage',
      idempotencyKey: 'staging:PRESENCAS:ambiguous:2:APR-2026-001|ABC',
      payload: {
        sourceSheet: 'PRESENCAS',
        classification: 'ambiguous',
        limitationReason: 'registro historico ambiguo sem status, justificativa ou ciencia de material',
        resolvedEntityType: null,
        resolvedEntityId: null,
      },
    });
    expect(JSON.stringify(result.operations[0].payload)).not.toContain('"attendanceStatus":"PRESENTE"');
    expect(JSON.stringify(result.operations[0].payload)).not.toContain('"attendanceStatus":"AUSENTE"');
    expect(result.issues).toMatchObject([{ severity: 'warning', code: 'AMBIGUOUS_EMPTY_RECORD' }]);
  });

  it('preserva original e normalizado parcial no staging ambiguo', () => {
    const result = parsePresencas([{ DATA: '16/03/2026', APRONTO_ID: 'APR 2026 001', ID: 'abc', STATUS: '', OBS: '', CIENCIA_MATERIAL: '' }]);
    const payload = result.operations[0].payload;

    expect(result.operations[0].operation).toBe('stage');
    expect(payload).toMatchObject({
      original: { APRONTO_ID: 'APR 2026 001', ID: 'abc' },
      normalized: { briefingId: 'APR-2026-001', trigram: 'ABC', recordedAt: '2026-03-16' },
    });
  });

  it('mantem idempotencia deterministica do staging', () => {
    const row = { DATA: '16/03/2026', APRONTO_ID: 'APR-2026-001', ID: 'abc', STATUS: '', OBS: '', CIENCIA_MATERIAL: '' };
    const first = parsePresencas([row]);
    const second = parsePresencas([row]);

    expect(first.operations[0].idempotencyKey).toBe(second.operations[0].idempotencyKey);
  });

  it('permite vinculo futuro do staging com registro definitivo sem apagar original', () => {
    const result = parsePresencas([{ DATA: '16/03/2026', APRONTO_ID: 'APR-2026-001', ID: 'abc', STATUS: '', OBS: '', CIENCIA_MATERIAL: '' }]);

    expect(result.operations[0].payload).toMatchObject({
      original: { APRONTO_ID: 'APR-2026-001', ID: 'abc' },
      resolvedEntityType: null,
      resolvedEntityId: null,
    });
  });

  it('redact oculta justificativa sem remover chave idempotente', () => {
    const sheet = parsePresencas([
      {
        DATA: '16/03/2026',
        APRONTO_ID: 'APR-2026-001',
        ID: 'abc',
        STATUS: 'JUSTIFICADO',
        OBS: 'Texto pessoal ficticio',
        CIENCIA_MATERIAL: 'SIM',
      },
    ]);
    const report = buildImportReport([sheet], '2026-01-01T00:00:00.000Z', { redact: true });
    const text = JSON.stringify(report);

    expect(text).not.toContain('Texto pessoal ficticio');
    expect(text).toContain('briefing-record:APR-2026-001:ABC');
    expect(text).toContain('[REDACTED]');
  });

  it('redact sanitiza conteudo aninhado de staging', () => {
    const sheet = parsePresencas([
      {
        DATA: '16/03/2026',
        APRONTO_ID: 'APR-2026-001',
        ID: 'abc',
        STATUS: 'PENDENTE_MANUAL',
        OBS: 'Texto pessoal ficticio',
        CIENCIA_MATERIAL: '',
      },
    ]);
    const report = buildImportReport([sheet], '2026-01-01T00:00:00.000Z', { redact: true });
    const text = JSON.stringify(report);

    expect(text).not.toContain('Texto pessoal ficticio');
    expect(text).toContain('[REDACTED]');
  });
});
