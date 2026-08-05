import 'server-only';
import { isValidDriveUrl } from './rules';
import type { AvopAcknowledgeResult, AvopListItem, AvopRepository } from './types';
import type { AuthenticatedSession } from '@/lib/auth/authorization';

export async function listApplicableAvopsForSession(
  session: AuthenticatedSession,
  repository: AvopRepository,
): Promise<AvopListItem[]> {
  return repository.listApplicableAvops(session.profileId);
}

export async function acknowledgeAvopForSession(input: {
  session: AuthenticatedSession;
  avopId: string;
  repository: AvopRepository;
  now?: Date;
}): Promise<AvopAcknowledgeResult> {
  const avopId = input.avopId.trim();
  if (!avopId) return { ok: false, reason: 'NOT_FOUND' };

  try {
    const avop = await input.repository.findApplicableAvop(input.session.profileId, avopId, input.now);
    if (!avop) return { ok: false, reason: 'NOT_APPLICABLE' };
    if (avop.status !== 'PUBLISHED' || !avop.requiresAcknowledgement) return { ok: false, reason: 'UNAVAILABLE' };
    if (!isValidDriveUrl(avop.driveUrl)) return { ok: false, reason: 'INVALID_DOCUMENT' };
    if (avop.acknowledgement) {
      return { ok: true, acknowledgement: avop.acknowledgement, alreadyAcknowledged: true };
    }

    const acknowledgement = await input.repository.acknowledgeAvop(
      input.session.profileId,
      avopId,
      input.now,
      input.session.persistentSessionId ?? null,
    );
    return { ok: true, acknowledgement, alreadyAcknowledged: false };
  } catch {
    return { ok: false, reason: 'INTERNAL_ERROR' };
  }
}

export async function extractAcknowledgeAvopId(formData: FormData): Promise<string> {
  if (hasClientSuppliedIdentity(formData)) return '';
  const value = formData.get('avopId');
  return typeof value === 'string' ? value : '';
}

function hasClientSuppliedIdentity(formData: FormData): boolean {
  const forbiddenFields = new Set(['profileid', 'profile_id', 'trigram', 'trigrama']);
  return Array.from(formData.keys()).some((key) => forbiddenFields.has(key.toLowerCase()));
}
