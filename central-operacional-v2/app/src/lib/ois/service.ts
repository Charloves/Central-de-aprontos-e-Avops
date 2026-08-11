import 'server-only';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import { searchOiDetailed } from '@/lib/domain/oi-search';
import { isValidOiDocumentUrl, normalizeOiAircraft, validateOiQuery } from './rules';
import type { OiRepository, OiSearchResponse } from './types';

export async function searchOiForSession(input: {
  session: AuthenticatedSession | null;
  repository: OiRepository;
  aircraft: unknown;
  query: unknown;
}): Promise<OiSearchResponse> {
  if (!input.session?.profileId) return { ok: false, reason: 'UNAUTHORIZED', items: [] };

  const aircraft = normalizeOiAircraft(input.aircraft);
  const query = validateOiQuery(input.query);
  if (!aircraft) return { ok: false, reason: 'INVALID_INPUT', items: [] };
  if (!query.ok && query.reason === 'empty') return { ok: true, status: 'empty', aircraft, query: '', items: [] };
  if (!query.ok) return { ok: false, reason: 'INVALID_INPUT', aircraft, items: [] };

  try {
    const records = await input.repository.listActiveOis();
    const result = searchOiDetailed(records, query.query, aircraft);
    return {
      ok: true,
      status: result.status,
      aircraft,
      query: query.query,
      items: result.items.map((item) => ({
        ...item,
        documentUrlValid: isValidOiDocumentUrl(item.driveUrl),
      })),
    };
  } catch {
    return { ok: false, reason: 'INTERNAL_ERROR', aircraft, query: query.query, items: [] };
  }
}
