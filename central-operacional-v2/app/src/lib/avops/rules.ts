import type { AvopListItem, AvopStatus } from './types';

const CANONICAL_AUDIENCES = new Set(['PILOTO', 'TRIPULANTE', 'HSAR', 'TODOS']);

export function normalizeAudienceCode(code: string): string {
  return code.trim().toUpperCase();
}

export function hasAudienceIntersection(profileAudiences: string[], avopAudiences: string[]): boolean {
  const profileSet = new Set(profileAudiences.map(normalizeAudienceCode));
  const avopSet = new Set(avopAudiences.map(normalizeAudienceCode));

  if (avopSet.has('TODOS')) return true;
  if (profileSet.has('TODOS') && avopSet.has('TODOS')) return true;
  return [...avopSet].some((code) => profileSet.has(code));
}

export function isKnownAudience(code: string): boolean {
  return CANONICAL_AUDIENCES.has(normalizeAudienceCode(code));
}

export function canAcknowledgeAvop(avop: AvopListItem): boolean {
  return avop.status === 'PUBLISHED' && avop.requiresAcknowledgement && isValidDriveUrl(avop.driveUrl);
}

export function getAvopSituation(status: AvopStatus): string {
  if (status === 'PUBLISHED') return 'Publicado';
  if (status === 'CLOSED') return 'Fechado';
  return 'Rascunho';
}

export function getAcknowledgementLabel(avop: AvopListItem): string {
  if (avop.acknowledgement) return 'AVOP assinado';
  if (!avop.requiresAcknowledgement) return 'Ciência não exigida';
  return 'Pendente';
}

export function isValidDriveUrl(value: string | null, environment = process.env.NODE_ENV): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;

    const allowedHosts = environment === 'production'
      ? new Set(['drive.google.com'])
      : new Set(['drive.google.com', 'example.test']);
    return allowedHosts.has(url.hostname);
  } catch {
    return false;
  }
}
