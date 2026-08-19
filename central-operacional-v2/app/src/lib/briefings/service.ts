import 'server-only';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import {
  canAcknowledgeMaterial,
  canJustifyAbsence,
  hasClientSuppliedBriefingIdentity,
  isValidBriefingMaterialUrl,
  normalizeJustificationText,
} from './rules';
import type {
  BriefingJustificationResult,
  BriefingListItem,
  BriefingMaterialResult,
  BriefingRepository,
} from './types';

export async function listApplicableBriefingsForSession(
  session: AuthenticatedSession,
  repository: BriefingRepository,
  now?: Date,
): Promise<BriefingListItem[]> {
  return repository.listApplicableBriefings(session.profileId, now);
}

export async function acknowledgeBriefingMaterialForSession(input: {
  session: AuthenticatedSession;
  briefingId: string;
  repository: BriefingRepository;
  now?: Date;
}): Promise<BriefingMaterialResult> {
  const briefingId = input.briefingId.trim();
  if (!briefingId) return { ok: false, reason: 'NOT_FOUND' };

  try {
    const briefing = await input.repository.findApplicableBriefing(input.session.profileId, briefingId, input.now);
    if (!briefing) return { ok: false, reason: 'NOT_APPLICABLE' };
    if (briefing.effectiveStatus !== 'OPEN' || !briefing.requiresMaterialAcknowledgement) {
      return { ok: false, reason: 'UNAVAILABLE' };
    }
    if (!isValidBriefingMaterialUrl(briefing.driveUrl)) return { ok: false, reason: 'INVALID_DOCUMENT' };
    if (briefing.record?.materialAcknowledged) {
      return { ok: true, record: briefing.record, alreadyAcknowledged: true };
    }

    const record = await input.repository.acknowledgeMaterial(input.session.profileId, briefingId, input.now);
    return { ok: true, record, alreadyAcknowledged: false };
  } catch {
    return { ok: false, reason: 'INTERNAL_ERROR' };
  }
}

export async function justifyBriefingAbsenceForSession(input: {
  session: AuthenticatedSession;
  briefingId: string;
  text: string;
  repository: BriefingRepository;
  now?: Date;
}): Promise<BriefingJustificationResult> {
  const briefingId = input.briefingId.trim();
  const text = normalizeJustificationText(input.text);
  if (!briefingId) return { ok: false, reason: 'NOT_FOUND' };
  if (!text) return { ok: false, reason: 'INVALID_TEXT' };

  try {
    const briefing = await input.repository.findApplicableBriefing(input.session.profileId, briefingId, input.now);
    if (!briefing) return { ok: false, reason: 'NOT_APPLICABLE' };
    if (!canJustifyAbsence(briefing)) return { ok: false, reason: 'UNAVAILABLE' };

    const justification = await input.repository.createJustification(input.session.profileId, briefingId, text, input.now);
    return { ok: true, justification };
  } catch {
    return { ok: false, reason: 'INTERNAL_ERROR' };
  }
}

export async function extractBriefingMaterialId(formData: FormData): Promise<string> {
  if (hasClientSuppliedBriefingIdentity(formData)) return '';
  const value = formData.get('briefingId');
  return typeof value === 'string' ? value : '';
}

export async function extractBriefingJustification(formData: FormData): Promise<{ briefingId: string; text: string }> {
  if (hasClientSuppliedBriefingIdentity(formData)) return { briefingId: '', text: '' };
  const briefingId = formData.get('briefingId');
  const text = formData.get('text');
  return {
    briefingId: typeof briefingId === 'string' ? briefingId : '',
    text: typeof text === 'string' ? text : '',
  };
}

export function getBriefingActionState(briefing: BriefingListItem): {
  canJustify: boolean;
  canAcknowledgeMaterial: boolean;
} {
  return {
    canJustify: canJustifyAbsence(briefing),
    canAcknowledgeMaterial: canAcknowledgeMaterial(briefing),
  };
}
