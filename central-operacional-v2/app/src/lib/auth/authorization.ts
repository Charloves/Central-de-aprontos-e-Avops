import { hasAdminRole, type SessionPayload } from './session';
import type { AuthProfile, ProfileRepository } from './profiles';

export type AuthenticatedSession = SessionPayload & {
  profileId: string;
  roles: AuthProfile['roles'];
};

export async function authorizeCurrentAdminSession(
  session: SessionPayload,
  repository: ProfileRepository,
): Promise<AuthenticatedSession | null> {
  const profile = await repository.findByTrigram(session.trigram);
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
