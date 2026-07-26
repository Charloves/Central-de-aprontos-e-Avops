import { describe, expect, it } from 'vitest';
import { searchOi } from './oi-search';
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
];

describe('oi-search', () => {
  it('retorna a fase correta por missao completa', () => {
    expect(searchOi(records, '01HE01D18', 'H50')[0]?.title).toBe('ADAPTAÇÃO DIURNA');
    expect(searchOi(records, '01HE01D20', 'H50')[0]?.title).toBe('ADAPTAÇÃO DIURNA AVANÇADA');
  });

  it('retorna opcoes por codigo base', () => {
    expect(searchOi(records, '01HE01', 'H50')).toHaveLength(2);
  });
});
