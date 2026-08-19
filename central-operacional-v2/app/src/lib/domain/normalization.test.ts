import { describe, expect, it } from 'vitest';
import { hasAudienceIntersection, normalizeAudienceList, normalizeAvopNumber, normalizeTrigram } from './normalization';

describe('normalization', () => {
  it('normaliza trigrama', () => {
    expect(normalizeTrigram(' cha ')).toBe('CHA');
  });

  it('normaliza formatos legados de AVOP', () => {
    expect(normalizeAvopNumber('AVOP-2026-01')).toBe('AVOP 01-2026');
    expect(normalizeAvopNumber('AVOP 01-2026')).toBe('AVOP 01-2026');
  });

  it('aceita perfis mistos com E, virgula e alias', () => {
    expect(normalizeAudienceList('PILOTO E TRIPULANTES')).toEqual(['PILOTO', 'TRIPULANTE']);
    expect(hasAudienceIntersection('PILOTO E HSAR', 'TRIPULANTE, HSAR')).toBe(true);
    expect(hasAudienceIntersection('TODOS', 'TRIPULANTE')).toBe(true);
  });
});
