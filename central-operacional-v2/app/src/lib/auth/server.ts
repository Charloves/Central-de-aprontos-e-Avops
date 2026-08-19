import 'server-only';
import { unstable_noStore as noStore } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SupabaseAuthSecurityRepository } from './supabase-security-repository';
import { SupabaseProfileRepository } from './supabase-profile-repository';
import { buildAuthenticatedSession, type AuthenticatedSession } from './authorization';
import {
  SESSION_COOKIE_NAME,
  assertStrongSessionSecret,
  hasAdminRole,
  verifySessionToken,
} from './session';
import { getSessionHashes, loadAuthSecurityConfig, type AuthSecurityRepository } from './security';
import type { ProfileRepository } from './profiles';

export async function readSession(
  repository: ProfileRepository = new SupabaseProfileRepository(),
  securityRepository: AuthSecurityRepository = new SupabaseAuthSecurityRepository(),
): Promise<AuthenticatedSession | null> {
  noStore();
  const secret = process.env.SESSION_SECRET;
  assertStrongSessionSecret(secret);
  const securityConfig = loadAuthSecurityConfig();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = verifySessionToken(token, secret);
  if (!session) return null;

  try {
    const { sessionIdentifierHash } = getSessionHashes(session, securityConfig.fingerprintSecret);
    const persistentSession = await securityRepository.touchSession({
      sessionIdentifierHash,
      touchIntervalSeconds: securityConfig.sessionTouchIntervalSeconds,
    });
    if (!persistentSession) return null;

    const profile = await repository.findById(persistentSession.profileId);
    if (!profile?.active) return null;

    return buildAuthenticatedSession(session, profile, persistentSession.sessionId);
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await readSession();
  if (!session) redirect('/?error=session');
  return session;
}

export async function requireAdminSession(): Promise<AuthenticatedSession> {
  const session = await requireSession();
  if (!hasAdminRole(session.roles)) redirect('/portal?error=forbidden');
  return session;
}
