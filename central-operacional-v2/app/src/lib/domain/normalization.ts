const PROFILE_ALIASES: Record<string, string[]> = {
  PILOTO: ['PILOTO'],
  PILOTOS: ['PILOTO'],
  TRIPULANTE: ['TRIPULANTE'],
  TRIPULANTES: ['TRIPULANTE'],
  TRIPULACAO: ['TRIPULANTE'],
  'TRIPULACAO OPERACIONAL': ['TRIPULANTE'],
  HSAR: ['HSAR'],
  TODOS: ['TODOS'],
};

export function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeUpper(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

export function normalizeTrigram(value: unknown): string {
  return normalizeUpper(value).replace(/\s+/g, '');
}

export function splitList(value: unknown): string[] {
  return normalizeUpper(value)
    .replace(/\s+E\s+/g, ',')
    .replace(/[;|\/]/g, ',')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeAudienceList(value: unknown): string[] {
  const out = new Set<string>();
  for (const item of splitList(value)) {
    for (const alias of PROFILE_ALIASES[item] ?? [item]) {
      out.add(alias);
    }
  }
  return [...out];
}

export function hasAudienceIntersection(targetAudiences: unknown, profileAudiences: unknown): boolean {
  const targets = normalizeAudienceList(targetAudiences);
  if (!targets.length) return false;
  if (targets.includes('TODOS')) return true;

  const profileSet = new Set(normalizeAudienceList(profileAudiences));
  return targets.some((target) => profileSet.has(target));
}

export function normalizeAvopNumber(value: unknown): string {
  const raw = normalizeUpper(value);
  if (!raw) return '';

  let match = raw.match(/^AVOP\D*(\d{2})\D*(\d{4})$/);
  if (match) return `AVOP ${match[1]}-${match[2]}`;

  match = raw.match(/^AVOP\D*(\d{4})\D*(\d{2})$/);
  if (match) return `AVOP ${match[2]}-${match[1]}`;

  return raw.replace(/\s+/g, ' ');
}

export function extractDriveFileId(url: unknown): string | null {
  const value = normalizeText(url);
  const fileMatch = value.match(/\/file\/d\/([^/]+)/);
  if (fileMatch) return fileMatch[1];

  const idMatch = value.match(/[?&]id=([^&]+)/);
  return idMatch ? idMatch[1] : null;
}
