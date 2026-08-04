import { hasAdminRole, type SessionPayload } from './session';
import type { AuthProfile, ProfileRepository } from './profiles';

export type AuthenticatedSession = SessionPayload & {
  trigram: string;
  profileId: string;
  roles: AuthProfile['roles'];
};

export async function authorizeCurrentAdminSession(
  session: SessionPayload & { profileId?: string },
  repository: ProfileRepository,
): Promise<AuthenticatedSession | null> {
  const profileId = typeof session.profileId === 'string' ? session.profileId : null;
  if (!profileId) return null;
  const profile = await repository.findById(profileId);
  if (!profile?.active || !hasAdminRole(profile.roles)) return null;
  return buildAuthenticatedSession(session, profile);
}

export function buildAuthenticatedSession(session: SessionPayload, profile: AuthProfile): AuthenticatedSession {
  return {
    ...session,
    trigram: profile.trigram,
    profileId: profile.id,
    roles: profile.roles,
  };
}
