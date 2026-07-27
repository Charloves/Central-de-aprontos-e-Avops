import { NextResponse } from 'next/server';
import { validateMutableRequest } from '@/lib/auth/csrf';
import { buildLogoutCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const csrf = validateMutableRequest({
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    appOrigin: process.env.APP_ORIGIN,
    environment: process.env.NODE_ENV,
  });
  if (!csrf.ok) return mutationFailure(csrf.status);

  const response = NextResponse.redirect(new URL('/', request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, '', buildLogoutCookieOptions(process.env.NODE_ENV));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function mutationFailure(status: 403) {
  const response = NextResponse.json({ error: 'Nao foi possivel processar a requisicao.' }, { status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
