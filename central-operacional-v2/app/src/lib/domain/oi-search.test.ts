import { describe, expect, it } from 'vitest';
import { searchOi, searchOiDetailed } from './oi-search';
import type { OiRecord } from './types';

const records: OiRecord[] = [
  {
    aircraft: 'H50',
    oiKey: 'PESOP|SPFO-1|01HE01|ADAPTACAO_DIURNA',
    program: 'PESOP',
    subprogram: 'SPFO-1',
    phaseId: '01HE01',
    title: 'ADAPTAÇÃO DIURNA',
    driveUrl: 'https://drive.google.com/file/d/abc/view',
    driveFileId: 'abc',
    startPage: 1,
    endPage: 3,
    displayKey: '01HE01 - ADAPTAÇÃO DIURNA',
    missionCodes: ['01HE01D01', '01HE01D02', '01HE01D18'],
    active: true,
  },
  {
    aircraft: 'H50',
    oiKey: 'PESOP|SPFO-1|01HE01|ADAPTACAO_DIURNA_AVANCADA',
    program: 'PESOP',
    subprogram: 'SPFO-1',
    phaseId: '01HE01',
    title: 'ADAPTAÇÃO DIURNA AVANÇADA',
    driveUrl: 'https://drive.google.com/file/d/def/view',
    driveFileId: 'def',
    startPage: 4,
    endPage: 5,
    displayKey: '01HE01 - ADAPTAÇÃO DIURNA AVANÇADA',
    missionCodes: ['01HE01D20', '01HE01D21'],
    active: true,
  },
  {
    aircraft: 'H125',
    oiKey: 'PESOP|SPHA-1|01HE01|ADAPTACAO_DIURNA',
    program: 'PESOP',
    subprogram: 'SPHA-1',
    phaseId: '01HE01',
    title: 'ADAPTACAO DIURNA H125',
    driveUrl: 'https://drive.google.com/file/d/h125/view',
    driveFileId: 'h125',
    startPage: 6,
    endPage: 8,
    displayKey: '01HE01 - ADAPTACAO DIURNA H125',
    missionCodes: ['01HE01D01', '01HE01D02'],
    active: true,
  },
];

describe('oi-search', () => {
  it('retorna a fase correta por missao completa', () => {
    expect(searchOi(records, '01HE01D18', 'H50')[0]?.title).toBe('ADAPTAÇÃO DIURNA');
    expect(searchOi(records, '01HE01D20', 'H50')[0]?.title).toBe('ADAPTAÇÃO DIURNA AVANÇADA');
  });

  it('retorna opcoes por codigo base', () => {
    expect(searchOi(records, '01HE01', 'H50')).toHaveLength(2);
  });

  it('retorna estado single para missao completa unica', () => {
    const result = searchOiDetailed(records, '01HE01D18', 'H50');

    expect(result.status).toBe('single');
    expect(result.items[0]?.oiKey).toBe('PESOP|SPFO-1|01HE01|ADAPTACAO_DIURNA');
  });

  it('retorna ambiguidade quando houver mais de uma correspondencia', () => {
    const result = searchOiDetailed(records, '01HE01', 'H50');

    expect(result.status).toBe('ambiguous');
    expect(result.items).toHaveLength(2);
  });

  it('filtra aeronave para mesma missao em frotas diferentes', () => {
    expect(searchOiDetailed(records, '01HE01D01', 'H50').items[0]?.aircraft).toBe('H50');
    expect(searchOiDetailed(records, '01HE01D01', 'H125').items[0]?.aircraft).toBe('H125');
  });

  it('busca por aeronave quando nao houver filtro externo', () => {
    const result = searchOiDetailed(records, 'H125');

    expect(result.status).toBe('single');
    expect(result.items[0]?.aircraft).toBe('H125');
  });

  it('retorna not_found para codigo inexistente', () => {
    expect(searchOiDetailed(records, '99ZZ99D01', 'H50')).toEqual({ status: 'not_found', items: [] });
  });

  it('busca por texto de fase ou missao sem escolher silenciosamente multiplos resultados', () => {
    expect(searchOiDetailed(records, 'ADAPTACAO DIURNA', 'H50').status).toBe('ambiguous');
    expect(searchOiDetailed(records, 'ADAPTACAO DIURNA AVANCADA', 'H50').status).toBe('single');
  });

  it('mantem ordenacao deterministica independentemente da ordem de entrada', () => {
    const sameKeyRecords: OiRecord[] = [
      {
        aircraft: 'H125',
        oiKey: 'PESOP|SPXX-1|09HE09|FASE_COMUM',
        program: 'PESOP',
        subprogram: 'SPXX-1',
        phaseId: '09HE09',
        title: 'FASE COMUM H125',
        driveUrl: 'https://drive.google.com/file/d/h125-common/view',
        driveFileId: 'h125-common',
        startPage: 2,
        endPage: 4,
        displayKey: '09HE09 - FASE COMUM H125',
        missionCodes: ['09HE09D01'],
        active: true,
      },
      {
        aircraft: 'H50',
        oiKey: 'PESOP|SPXX-1|09HE09|FASE_COMUM',
        program: 'PESOP',
        subprogram: 'SPXX-1',
        phaseId: '09HE09',
        title: 'FASE COMUM H50',
        driveUrl: 'https://drive.google.com/file/d/h50-common/view',
        driveFileId: 'h50-common',
        startPage: 3,
        endPage: 5,
        displayKey: '09HE09 - FASE COMUM H50',
        missionCodes: ['09HE09D01'],
        active: true,
      },
    ];

    const first = searchOiDetailed(sameKeyRecords, '09HE09D01');
    const second = searchOiDetailed([...sameKeyRecords].reverse(), '09HE09D01');

    expect(first).toMatchObject({ status: 'ambiguous' });
    expect(second).toMatchObject({ status: 'ambiguous' });
    expect(first.items.map((item) => item.aircraft)).toEqual(['H125', 'H50']);
    expect(second.items.map((item) => item.aircraft)).toEqual(['H125', 'H50']);
  });

  it('nao retorna OI inativa na consulta operacional', () => {
    const inactiveRecords: OiRecord[] = [
      {
        ...records[0],
        active: false,
      },
    ];

    expect(searchOiDetailed(inactiveRecords, '01HE01D01', 'H50')).toEqual({ status: 'not_found', items: [] });
  });

  it('nao usa fallback por fase quando codigo completo nao pertence a MISSOES', () => {
    expect(searchOiDetailed(records, '01HE01D19', 'H50')).toEqual({ status: 'not_found', items: [] });
  });

  it('permite fallback por fase quando MISSOES estiver vazio', () => {
    const noMissionList: OiRecord[] = [
      {
        ...records[0],
        oiKey: 'PESOP|SPFO-2|02HE02|FASE_SEM_LISTA',
        phaseId: '02HE02',
        displayKey: '02HE02 - FASE SEM LISTA',
        missionCodes: [],
      },
    ];

    const result = searchOiDetailed(noMissionList, '02HE02D99', 'H50');

    expect(result.status).toBe('single');
    expect(result.items[0]?.phaseId).toBe('02HE02');
  });
});
