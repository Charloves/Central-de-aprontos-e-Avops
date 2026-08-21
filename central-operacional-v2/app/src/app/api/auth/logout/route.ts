import { NextResponse } from 'next/server';
import { validateMutableRequest } from '@/lib/auth/csrf';
import { getSessionHashes, loadAuthSecurityConfig } from '@/lib/auth/security';
import { buildLogoutCookieOptions, SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';
import { SupabaseAuthSecurityRepository } from '@/lib/auth/supabase-security-repository';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const csrf = validateMutableRequest({
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    appOrigin: process.env.APP_ORIGIN,
    environment: process.env.NODE_ENV,
  });
  if (!csrf.ok) return mutationFailure(csrf.status);

  await revokePersistentSession(request);

  const response = NextResponse.redirect(new URL('/', request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, '', buildLogoutCookieOptions(process.env.NODE_ENV));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function mutationFailure(status: 403) {
  const response = NextResponse.json({ error: 'Não foi possível processar a requisição.' }, { status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

async function revokePersistentSession(request: Request): Promise<void> {
  try {
    const cookie = request.headers.get('cookie') ?? '';
    const token = cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.slice(SESSION_COOKIE_NAME.length + 1);
    if (!token) return;
    const secret = process.env.SESSION_SECRET;
    if (!secret) return;
    const session = verifySessionToken(decodeURIComponent(token), secret);
    if (!session) return;
    const config = loadAuthSecurityConfig();
    const { sessionIdentifierHash } = getSessionHashes(session, config.fingerprintSecret);
    await new SupabaseAuthSecurityRepository().revokeSession({
      sessionIdentifierHash,
      reason: 'LOGOUT',
    });
  } catch {
    return;
  }
}
