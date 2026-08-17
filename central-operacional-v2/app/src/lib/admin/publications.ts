import { hasAdminRole } from '@/lib/auth/session';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import { isValidDriveUrl, normalizeAudienceCode } from '@/lib/avops/rules';

export type PublicationAudienceCode = 'PILOTO' | 'TRIPULANTE' | 'HSAR' | 'TODOS';

export type AdminAudience = {
  id: string;
  code: PublicationAudienceCode;
  name: string;
};

export type AdminAvopDraft = {
  id: string;
  number: string;
  title: string;
  publicationDate: string;
  driveUrl: string;
  driveFileId: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  requiresAcknowledgement: boolean;
  audiences: PublicationAudienceCode[];
  snapshot?: AdminPublicationSnapshot | null;
};

export type AdminBriefingDraft = {
  id: string;
  legacyId: string;
  title: string;
  eventDate: string;
  driveUrl: string;
  driveFileId: string | null;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  requiresMaterialAcknowledgement: boolean;
  audiences: PublicationAudienceCode[];
  snapshot?: AdminPublicationSnapshot | null;
};

export type AdminPublicationSnapshot = {
  id: string;
  publishedAt: string;
  applicableProfileCount: number;
};

export type AdminPublicationPayload = {
  audiences: PublicationAudienceCode[];
  number?: string;
  legacy_id?: string;
  title: string;
  publication_date?: string;
  event_date?: string;
  drive_url: string;
  drive_file_id: string | null;
  requires_acknowledgement?: boolean;
  requires_material_acknowledgement?: boolean;
};

export type AdminPublicationResult =
  | { ok: true; id: string; snapshotId?: string; applicableProfileCount?: number; alreadyPublished?: boolean }
  | { ok: false; reason: 'FORBIDDEN' | 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_EDITABLE' | 'NO_AUDIENCE' | 'NO_APPLICABLE_PROFILES' | 'INTERNAL_ERROR' };

export type AdminPublicationRepository = {
  listAudiences(): Promise<AdminAudience[]>;
  listAvops(): Promise<AdminAvopDraft[]>;
  findAvop(id: string): Promise<AdminAvopDraft | null>;
  saveAvopDraft(input: {
    actorProfileId: string;
    draftId: string | null;
    payload: AdminPublicationPayload;
    now?: Date;
  }): Promise<AdminPublicationResult>;
  publishAvop(input: {
    actorProfileId: string;
    avopId: string;
    now?: Date;
  }): Promise<AdminPublicationResult>;
  listBriefings(): Promise<AdminBriefingDraft[]>;
  findBriefing(id: string): Promise<AdminBriefingDraft | null>;
  saveBriefingDraft(input: {
    actorProfileId: string;
    draftId: string | null;
    payload: AdminPublicationPayload;
    now?: Date;
  }): Promise<AdminPublicationResult>;
  publishBriefing(input: {
    actorProfileId: string;
    briefingId: string;
    now?: Date;
  }): Promise<AdminPublicationResult>;
};

const KNOWN_AUDIENCES = new Set(['PILOTO', 'TRIPULANTE', 'HSAR', 'TODOS']);
const FORBIDDEN_CLIENT_IDENTITY_FIELDS = new Set([
  'profileid',
  'profile_id',
  'actorprofileid',
  'actor_profile_id',
  'trigram',
  'trigrama',
  'role',
  'roles',
  'sessionid',
  'session_id',
  'createdby',
  'created_by',
]);

export function parseAvopDraftForm(formData: FormData): { ok: true; draftId: string | null; payload: AdminPublicationPayload } | { ok: false } {
  if (hasClientSuppliedIdentity(formData)) return { ok: false };

  const draftId = optionalString(formData.get('draftId'));
  const number = requiredText(formData.get('number'), 1, 80);
  const title = requiredText(formData.get('title'), 1, 240);
  const publicationDate = parseDateField(formData.get('publicationDate'));
  const driveUrl = requiredText(formData.get('driveUrl'), 1, 1000);
  const driveFileId = optionalString(formData.get('driveFileId'));
  const audiences = parseAudienceFields(formData);
  if (!number || !title || !publicationDate || !driveUrl || audiences.length === 0) return { ok: false };
  if (!isValidDriveUrl(driveUrl)) return { ok: false };

  return {
    ok: true,
    draftId,
    payload: {
      number,
      title,
      publication_date: publicationDate,
      drive_url: driveUrl,
      drive_file_id: driveFileId,
      requires_acknowledgement: formData.get('requiresAcknowledgement') === 'on',
      audiences,
    },
  };
}

export function parseBriefingDraftForm(formData: FormData): { ok: true; draftId: string | null; payload: AdminPublicationPayload } | { ok: false } {
  if (hasClientSuppliedIdentity(formData)) return { ok: false };

  const draftId = optionalString(formData.get('draftId'));
  const legacyId = requiredText(formData.get('legacyId'), 1, 80);
  const title = requiredText(formData.get('title'), 1, 240);
  const eventDate = parseDateField(formData.get('eventDate'));
  const driveUrl = requiredText(formData.get('driveUrl'), 1, 1000);
  const driveFileId = optionalString(formData.get('driveFileId'));
  const audiences = parseAudienceFields(formData);
  if (!legacyId || !title || !eventDate || !driveUrl || audiences.length === 0) return { ok: false };
  if (!isValidDriveUrl(driveUrl)) return { ok: false };

  return {
    ok: true,
    draftId,
    payload: {
      legacy_id: legacyId,
      title,
      event_date: eventDate,
      drive_url: driveUrl,
      drive_file_id: driveFileId,
      requires_material_acknowledgement: formData.get('requiresMaterialAcknowledgement') === 'on',
      audiences,
    },
  };
}

export function parsePublishForm(formData: FormData): { ok: true; id: string } | { ok: false } {
  if (hasClientSuppliedIdentity(formData)) return { ok: false };
  const id = optionalString(formData.get('id'));
  if (!id || !isUuid(id)) return { ok: false };
  return { ok: true, id };
}

export async function saveAvopDraftForSession(input: {
  session: AuthenticatedSession;
  formData: FormData;
  repository: AdminPublicationRepository;
  now?: Date;
}): Promise<AdminPublicationResult> {
  if (!hasAdminRole(input.session.roles)) return { ok: false, reason: 'FORBIDDEN' };
  const parsed = parseAvopDraftForm(input.formData);
  if (!parsed.ok) return { ok: false, reason: 'INVALID_INPUT' };
  return input.repository.saveAvopDraft({
    actorProfileId: input.session.profileId,
    draftId: parsed.draftId,
    payload: parsed.payload,
    now: input.now,
  });
}

export async function publishAvopForSession(input: {
  session: AuthenticatedSession;
  formData: FormData;
  repository: AdminPublicationRepository;
  now?: Date;
}): Promise<AdminPublicationResult> {
  if (!hasAdminRole(input.session.roles)) return { ok: false, reason: 'FORBIDDEN' };
  const parsed = parsePublishForm(input.formData);
  if (!parsed.ok) return { ok: false, reason: 'INVALID_INPUT' };
  return input.repository.publishAvop({
    actorProfileId: input.session.profileId,
    avopId: parsed.id,
    now: input.now,
  });
}

export async function saveBriefingDraftForSession(input: {
  session: AuthenticatedSession;
  formData: FormData;
  repository: AdminPublicationRepository;
  now?: Date;
}): Promise<AdminPublicationResult> {
  if (!hasAdminRole(input.session.roles)) return { ok: false, reason: 'FORBIDDEN' };
  const parsed = parseBriefingDraftForm(input.formData);
  if (!parsed.ok) return { ok: false, reason: 'INVALID_INPUT' };
  return input.repository.saveBriefingDraft({
    actorProfileId: input.session.profileId,
    draftId: parsed.draftId,
    payload: parsed.payload,
    now: input.now,
  });
}

export async function publishBriefingForSession(input: {
  session: AuthenticatedSession;
  formData: FormData;
  repository: AdminPublicationRepository;
  now?: Date;
}): Promise<AdminPublicationResult> {
  if (!hasAdminRole(input.session.roles)) return { ok: false, reason: 'FORBIDDEN' };
  const parsed = parsePublishForm(input.formData);
  if (!parsed.ok) return { ok: false, reason: 'INVALID_INPUT' };
  return input.repository.publishBriefing({
    actorProfileId: input.session.profileId,
    briefingId: parsed.id,
    now: input.now,
  });
}

export function hasClientSuppliedIdentity(formData: FormData): boolean {
  return Array.from(formData.keys()).some((key) => FORBIDDEN_CLIENT_IDENTITY_FIELDS.has(key.toLowerCase()));
}

function parseAudienceFields(formData: FormData): PublicationAudienceCode[] {
  const values = formData.getAll('audiences')
    .map((value) => normalizeAudienceCode(String(value)))
    .filter((value) => value !== '');
  const unique = Array.from(new Set(values));
  if (unique.some((value) => !KNOWN_AUDIENCES.has(value))) return [];
  return unique as PublicationAudienceCode[];
}

function requiredText(value: FormDataEntryValue | null, min: number, max: number): string | null {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) return null;
  if (hasControlCharacter(text)) return null;
  return text;
}

function optionalString(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > 1000 || hasControlCharacter(text)) return null;
  return text;
}

function parseDateField(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return text;
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
