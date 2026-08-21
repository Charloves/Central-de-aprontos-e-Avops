import { isValidDriveUrl } from '@/lib/avops/rules';
import type { OiAircraft } from './types';

export const MAX_OI_QUERY_LENGTH = 80;
export const MAX_OI_COMPACT_QUERY_LENGTH = 40;

const SAFE_QUERY_PATTERN = /^[\p{L}\p{N}\s._|/-]+$/u;

export function normalizeOiAircraft(value: unknown): OiAircraft | null {
  if (typeof value !== 'string') return null;
  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact === 'H50') return 'H50';
  if (compact === 'H125') return 'H125';
  return null;
}

export function formatOiAircraft(value: OiAircraft): string {
  return value === 'H50' ? 'H-50' : 'H-125';
}

export function validateOiQuery(value: unknown): { ok: true; query: string } | { ok: false; reason: 'empty' | 'invalid' } {
  if (typeof value !== 'string') return { ok: false, reason: 'empty' };
  if (/[\u0000-\u001F\u007F]/.test(value)) return { ok: false, reason: 'invalid' };
  const query = value.trim().replace(/\s+/g, ' ');
  if (!query) return { ok: false, reason: 'empty' };
  if (query.length > MAX_OI_QUERY_LENGTH) return { ok: false, reason: 'invalid' };
  if (!SAFE_QUERY_PATTERN.test(query)) return { ok: false, reason: 'invalid' };
  const compactLength = query.replace(/[^A-Za-z0-9]/g, '').length;
  if (compactLength < 3 || compactLength > MAX_OI_COMPACT_QUERY_LENGTH) return { ok: false, reason: 'invalid' };
  return { ok: true, query };
}

export function isValidOiDocumentUrl(value: string | null, environment = process.env.NODE_ENV): boolean {
  return isValidDriveUrl(value, environment);
}

export function formatPageRange(startPage: number, endPage: number | null): string {
  if (!Number.isInteger(startPage) || startPage < 1) return 'Página não informada';
  if (!Number.isInteger(endPage) || endPage === null || endPage < startPage) return `Página ${startPage}`;
  if (endPage === startPage) return `Página ${startPage}`;
  return `Páginas ${startPage} a ${endPage}`;
}
