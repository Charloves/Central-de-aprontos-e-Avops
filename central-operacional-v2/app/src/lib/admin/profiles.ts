import { normalizeTrigram, normalizeUpper } from '@/lib/domain/normalization';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import type { AudienceCode, Role } from '@/lib/domain/types';

export type AdminProfileSummary = {
  profileId: string;
  trigram: string;
  name: string;
  email: string | null;
  active: boolean;
  roles: Role[];
  audiences: AudienceCode[];
};

export type AdminProfileSaveInput = {
  actorProfileId: string;
  targetProfileId: string | null;
  payload: {
    trigram: string;
    name: string;
    email: string | null;
    active: boolean;
    roles: Extract<Role, 'USER' | 'COORDINATOR'>[];
    audienceCodes: string[];
  };
  now?: Date;
};

export type AdminProfileSaveResult =
  | { ok: true; profileId: string; auditId: string; sessionsRevoked: number }
  | { ok: false; reason: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR' };

export type ProfileAdminRepository = {
  listProfiles(): Promise<AdminProfileSummary[]>;
  listAudienceCodes(): Promise<string[]>;
  saveProfile(input: AdminProfileSaveInput): Promise<AdminProfileSaveResult>;
};

const SIMPLE_EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAdminProfileForm(
  formData: FormData,
): { ok: true; input: Omit<AdminProfileSaveInput, 'actorProfileId' | 'now'> } | { ok: false } {
  if (hasClientSuppliedAdminIdentity(formData)) return { ok: false };

  const targetRaw = String(formData.get('targetProfileId') ?? '').trim();
  const targetProfileId = targetRaw ? targetRaw : null;
  if (targetProfileId && !UUID_PATTERN.test(targetProfileId)) return { ok: false };

  const trigram = normalizeTrigram(formData.get('trigram'));
  const name = String(formData.get('name') ?? '').trim();
  const emailRaw = String(formData.get('email') ?? '').trim().toLowerCase();
  const email = emailRaw || null;
  const active = formData.get('active') === 'on';
  const audienceCodes = normalizeStringArray(formData.getAll('audienceCodes'));
  const rawRoles = normalizeStringArray(formData.getAll('roles'));
  const roles = normalizeRoleArray(formData.getAll('roles'));

  if (!isValidTrigram(trigram)) return { ok: false };
  if (name.length < 2 || name.length > 120) return { ok: false };
  if (email && !isValidEmail(email)) return { ok: false };
  if (audienceCodes.length === 0) return { ok: false };
  if (roles.length === 0 || rawRoles.includes('ADMIN')) return { ok: false };

  return {
    ok: true,
    input: {
      targetProfileId,
      payload: {
        trigram,
        name,
        email,
        active,
        roles,
        audienceCodes,
      },
    },
  };
}

export async function saveAdminProfileForSession(input: {
  session: AuthenticatedSession;
  formData: FormData;
  repository: ProfileAdminRepository;
  now?: Date;
}): Promise<AdminProfileSaveResult> {
  if (!input.session.roles.includes('ADMIN')) return { ok: false, reason: 'FORBIDDEN' };

  const parsed = parseAdminProfileForm(input.formData);
  if (!parsed.ok) return { ok: false, reason: 'INVALID_INPUT' };

  return input.repository.saveProfile({
    actorProfileId: input.session.profileId,
    ...parsed.input,
    now: input.now,
  });
}

export function hasClientSuppliedAdminIdentity(formData: FormData): boolean {
  const forbiddenFields = new Set([
    'actorprofileid',
    'actor_profile_id',
    'adminprofileid',
    'admin_profile_id',
    'assignedby',
    'assigned_by',
    'sessionid',
    'session_id',
    'trigram_actor',
    'actortrigram',
    'actor_trigram',
  ]);
  return Array.from(formData.keys()).some((key) => forbiddenFields.has(key.toLowerCase()));
}

export function isValidTrigram(value: string): boolean {
  return /^[A-Z0-9]{2,10}$/.test(value);
}

function isValidEmail(value: string): boolean {
  return value.trim() === value
    && !value.includes(' ')
    && !value.includes(',')
    && !value.includes(';')
    && !/[\x00-\x1F\x7F]/.test(value)
    && SIMPLE_EMAIL_PATTERN.test(value);
}

function normalizeStringArray(values: FormDataEntryValue[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeUpper(value);
    if (normalized) out.add(normalized);
  }
  return [...out].sort();
}

function normalizeRoleArray(values: FormDataEntryValue[]): Extract<Role, 'USER' | 'COORDINATOR'>[] {
  const roles = normalizeStringArray(values);
  const out: Extract<Role, 'USER' | 'COORDINATOR'>[] = [];
  if (roles.includes('USER')) out.push('USER');
  if (roles.includes('COORDINATOR')) out.push('COORDINATOR');
  if (!out.includes('USER')) out.unshift('USER');
  return out;
}
