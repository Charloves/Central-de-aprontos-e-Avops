import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseAprontos, parseAvops, parseEfetivo, parseLeituras, parseOiH125, parseOiH50, parsePresencas } from './legacy';
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

    expect(result).toMatchObject({ valid: 0, invalid: 0, metrics: { stagingAmbiguos: 1 } });
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

  it('normaliza OI H50 e preserva link original do Drive', () => {
    const result = parseOiH50([
      {
        OI_KEY: ' pesop | spfo-1 | 01he01 | fase_alfa ',
        PROGRAMA: 'pesop',
        SUBPROGRAMA: 'spfo-1',
        FASE_ID: '01he01',
        TITULO: 'Fase ficticia alfa',
        PDF_URL: 'https://drive.google.com/file/d/fake-h50-full/view',
        PDF_FASE_URL: 'https://drive.google.com/file/d/fake-h50-phase/view',
        PAG_INICIAL: '10',
        PAG_FINAL: '12',
        TIPO: 'fase_alfa',
        STATUS: 'ativo',
        CHAVE_EXIBICAO: '01HE01 - Fase ficticia alfa',
        MISSOES: '01HE01D01 01HE01D18',
      },
    ]);

    expect(result).toMatchObject({ valid: 1, invalid: 0, duplicates: 0, normalized: 1 });
    expect(result.metrics).toMatchObject({ oiH50: 1, validosOi: 1 });
    expect(result.operations[0]).toMatchObject({
      operation: 'upsert',
      idempotencyKey: 'oi:H50:PESOP|SPFO-1|01HE01|FASE_ALFA',
      payload: {
        aircraft: 'H50',
        oiKey: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
        phaseId: '01HE01',
        driveUrl: 'https://drive.google.com/file/d/fake-h50-phase/view',
        driveFileId: 'fake-h50-phase',
        missionCodes: ['01HE01D01', '01HE01D18'],
      },
    });
  });

  it('distingue H50 e H125 para a mesma fase e missao', () => {
    const h50 = parseOiH50([
      {
        OI_KEY: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPFO-1',
        FASE_ID: '01HE01',
        TITULO: 'Fase ficticia alfa H50',
        PDF_URL: '',
        PDF_FASE_URL: 'https://drive.google.com/file/d/fake-h50-phase/view',
        PAG_INICIAL: '10',
        PAG_FINAL: '12',
        TIPO: 'FASE_ALFA',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '01HE01 - Fase ficticia alfa H50',
        MISSOES: '01HE01D01',
      },
    ]);
    const h125 = parseOiH125([
      {
        OI_KEY: 'PESOP|SPHA-1|01HE01|FASE_ALFA',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPHA-1',
        FASE_ID: '01HE01',
        TITULO: 'Fase ficticia alfa H125',
        PDF_URL: '',
        PDF_FASE_URL: 'https://drive.google.com/file/d/fake-h125-phase/view',
        PAG_INICIAL: '11',
        PAG_FINAL: '13',
        TIPO: 'FASE_ALFA',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '01HE01 - Fase ficticia alfa H125',
        MISSOES: '01HE01D01',
      },
    ]);

    expect(h50.operations[0].idempotencyKey).toBe('oi:H50:PESOP|SPFO-1|01HE01|FASE_ALFA');
    expect(h125.operations[0].idempotencyKey).toBe('oi:H125:PESOP|SPHA-1|01HE01|FASE_ALFA');
  });

  it('envia OI sem link para staging invalido', () => {
    const result = parseOiH50([
      {
        OI_KEY: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPFO-1',
        FASE_ID: '01HE01',
        TITULO: 'Fase ficticia sem link',
        PDF_URL: '',
        PDF_FASE_URL: '',
        PAG_INICIAL: '10',
        PAG_FINAL: '12',
        TIPO: 'FASE_ALFA',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '01HE01 - Fase ficticia sem link',
        MISSOES: '01HE01D01',
      },
    ]);

    expect(result).toMatchObject({ valid: 0, invalid: 1 });
    expect(result.operations[0]).toMatchObject({
      operation: 'stage',
      idempotencyKey: 'staging:OI_H50:invalid:2:H50|PESOP|SPFO-1|01HE01|FASE_ALFA',
      payload: { classification: 'invalid' },
    });
  });

  it('aceita formatos legitimos de link do Google Drive e extrai driveFileId', () => {
    const result = parseOiH50([
      {
        OI_KEY: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPFO-1',
        FASE_ID: '01HE01',
        TITULO: 'Fase ficticia alfa',
        PDF_URL: 'https://drive.google.com/file/d/fake-file-id/view',
        PDF_FASE_URL: '',
        PAG_INICIAL: '10',
        PAG_FINAL: '12',
        TIPO: 'FASE_ALFA',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '01HE01 - Fase ficticia alfa',
        MISSOES: '01HE01D01',
      },
      {
        OI_KEY: 'PESOP|SPFO-2|02HE02|FASE_BRAVO',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPFO-2',
        FASE_ID: '02HE02',
        TITULO: 'Fase ficticia bravo',
        PDF_URL: 'https://drive.google.com/open?id=fake-open-id',
        PDF_FASE_URL: '',
        PAG_INICIAL: '20',
        PAG_FINAL: '22',
        TIPO: 'FASE_BRAVO',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '02HE02 - Fase ficticia bravo',
        MISSOES: '02HE02D01',
      },
      {
        OI_KEY: 'PESOP|SPFO-3|03HE03|FASE_CHARLIE',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPFO-3',
        FASE_ID: '03HE03',
        TITULO: 'Fase ficticia charlie',
        PDF_URL: 'https://drive.google.com/uc?export=download&id=fake-uc-id',
        PDF_FASE_URL: '',
        PAG_INICIAL: '30',
        PAG_FINAL: '32',
        TIPO: 'FASE_CHARLIE',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '03HE03 - Fase ficticia charlie',
        MISSOES: '03HE03D01',
      },
    ]);

    expect(result).toMatchObject({ valid: 3, invalid: 0 });
    expect(result.operations.map((operation) => operation.payload).filter((payload) => 'driveFileId' in payload)).toMatchObject([
      { driveFileId: 'fake-file-id' },
      { driveFileId: 'fake-open-id' },
      { driveFileId: 'fake-uc-id' },
    ]);
  });

  it('envia link nao reconhecido como Google Drive para staging invalido preservando original', () => {
    const result = parseOiH50([
      {
        OI_KEY: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPFO-1',
        FASE_ID: '01HE01',
        TITULO: 'Fase ficticia alfa',
        PDF_URL: 'https://example.test/documento.pdf',
        PDF_FASE_URL: '',
        PAG_INICIAL: '10',
        PAG_FINAL: '12',
        TIPO: 'FASE_ALFA',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '01HE01 - Fase ficticia alfa',
        MISSOES: '01HE01D01',
      },
    ]);

    expect(result).toMatchObject({ valid: 0, invalid: 1 });
    expect(result.operations[0]).toMatchObject({
      operation: 'stage',
      payload: {
        classification: 'invalid',
        original: { PDF_URL: 'https://example.test/documento.pdf' },
      },
    });
    expect(result.issues).toMatchObject([{ code: 'INVALID_DRIVE_URL' }]);
  });

  it('preserva OI inativa na importacao sem tratar como invalida', () => {
    const result = parseOiH50([
      {
        OI_KEY: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPFO-1',
        FASE_ID: '01HE01',
        TITULO: 'Fase ficticia alfa',
        PDF_URL: 'https://drive.google.com/file/d/fake-h50-phase/view',
        PDF_FASE_URL: '',
        PAG_INICIAL: '10',
        PAG_FINAL: '12',
        TIPO: 'FASE_ALFA',
        STATUS: 'INATIVO',
        CHAVE_EXIBICAO: '01HE01 - Fase ficticia alfa',
        MISSOES: '01HE01D01',
      },
    ]);

    expect(result).toMatchObject({ valid: 1, invalid: 0 });
    expect(result.operations[0]).toMatchObject({
      operation: 'upsert',
      payload: { status: 'INATIVO', active: false },
    });
  });

  it('envia intervalo de paginas invalido para staging preservando valores originais', () => {
    const result = parseOiH50([
      {
        OI_KEY: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPFO-1',
        FASE_ID: '01HE01',
        TITULO: 'Fase ficticia alfa',
        PDF_URL: 'https://drive.google.com/file/d/fake-h50-phase/view',
        PDF_FASE_URL: '',
        PAG_INICIAL: '12',
        PAG_FINAL: '10',
        TIPO: 'FASE_ALFA',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '01HE01 - Fase ficticia alfa',
        MISSOES: '01HE01D01',
      },
    ]);

    expect(result).toMatchObject({ valid: 0, invalid: 1 });
    expect(result.operations[0]).toMatchObject({
      operation: 'stage',
      payload: {
        classification: 'invalid',
        original: { PAG_INICIAL: '12', PAG_FINAL: '10' },
      },
    });
    expect(result.issues).toMatchObject([{ code: 'INVALID_PAGE_RANGE' }]);
  });

  it('envia OI com missao fora da fase para staging ambiguo', () => {
    const result = parseOiH125([
      {
        OI_KEY: 'PEVOP|SPHA-2|04HE04|FASE_DELTA',
        PROGRAMA: 'PEVOP',
        SUBPROGRAMA: 'SPHA-2',
        FASE_ID: '04HE04',
        TITULO: 'Fase ficticia delta',
        PDF_URL: '',
        PDF_FASE_URL: 'https://drive.google.com/file/d/fake-h125-delta/view',
        PAG_INICIAL: '40',
        PAG_FINAL: '42',
        TIPO: 'FASE_DELTA',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '04HE04 - Fase ficticia delta',
        MISSOES: '04HE04D01 04HE99D02',
      },
    ]);

    expect(result).toMatchObject({ valid: 0, invalid: 0 });
    expect(result.operations[0]).toMatchObject({
      operation: 'stage',
      idempotencyKey: 'staging:OI_H125:ambiguous:2:H125|PEVOP|SPHA-2|04HE04|FASE_DELTA',
      payload: { classification: 'ambiguous' },
    });
    expect(result.issues).toMatchObject([{ code: 'MISSION_PHASE_MISMATCH' }]);
  });

  it('envia duplicidade de OI para staging sem eliminar o primeiro valido', () => {
    const row = {
      OI_KEY: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
      PROGRAMA: 'PESOP',
      SUBPROGRAMA: 'SPFO-1',
      FASE_ID: '01HE01',
      TITULO: 'Fase ficticia alfa',
      PDF_URL: '',
      PDF_FASE_URL: 'https://drive.google.com/file/d/fake-h50-phase/view',
      PAG_INICIAL: '10',
      PAG_FINAL: '12',
      TIPO: 'FASE_ALFA',
      STATUS: 'ATIVO',
      CHAVE_EXIBICAO: '01HE01 - Fase ficticia alfa',
      MISSOES: '01HE01D01',
    };

    const result = parseOiH50([row, { ...row, TITULO: 'Fase ficticia alfa duplicada' }]);

    expect(result).toMatchObject({ valid: 1, duplicates: 1 });
    expect(result.operations[0]).toMatchObject({ operation: 'upsert' });
    expect(result.operations[1]).toMatchObject({ operation: 'stage', payload: { classification: 'duplicate' } });
  });

  it('mantem idempotencia deterministica da OI', () => {
    const row = {
      OI_KEY: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
      PROGRAMA: 'PESOP',
      SUBPROGRAMA: 'SPFO-1',
      FASE_ID: '01HE01',
      TITULO: 'Fase ficticia alfa',
      PDF_URL: '',
      PDF_FASE_URL: 'https://drive.google.com/file/d/fake-h50-phase/view',
      PAG_INICIAL: '10',
      PAG_FINAL: '12',
      TIPO: 'FASE_ALFA',
      STATUS: 'ATIVO',
      CHAVE_EXIBICAO: '01HE01 - Fase ficticia alfa',
      MISSOES: '01HE01D01',
    };

    expect(parseOiH50([row]).operations[0].idempotencyKey).toBe(parseOiH50([row]).operations[0].idempotencyKey);
  });

  it('redact oculta titulo e chave de exibicao de OI em relatorio compartilhavel', () => {
    const sheet = parseOiH50([
      {
        OI_KEY: 'PESOP|SPFO-1|01HE01|FASE_ALFA',
        PROGRAMA: 'PESOP',
        SUBPROGRAMA: 'SPFO-1',
        FASE_ID: '01HE01',
        TITULO: 'Texto operacional ficticio',
        PDF_URL: '',
        PDF_FASE_URL: 'https://drive.google.com/file/d/fake-h50-phase/view',
        PAG_INICIAL: '10',
        PAG_FINAL: '12',
        TIPO: 'FASE_ALFA',
        STATUS: 'ATIVO',
        CHAVE_EXIBICAO: '01HE01 - Texto operacional ficticio',
        MISSOES: '01HE01D01',
      },
    ]);
    const report = buildImportReport([sheet], '2026-01-01T00:00:00.000Z', { redact: true });
    const text = JSON.stringify(report);

    expect(text).not.toContain('Texto operacional ficticio');
    expect(text).toContain('oi:H50:PESOP|SPFO-1|01HE01|FASE_ALFA');
    expect(text).toContain('[REDACTED]');
  });
});
