import { NextResponse } from 'next/server';
import { validateMutableRequest } from '@/lib/auth/csrf';
import { authenticateTrigram } from '@/lib/auth/login';
import {
  buildAuthSecurityContext,
  loadAuthSecurityConfig,
  resolveTrustedNetworkOrigin,
} from '@/lib/auth/security';
import { SupabaseAuthSecurityRepository } from '@/lib/auth/supabase-security-repository';
import { SupabaseProfileRepository } from '@/lib/auth/supabase-profile-repository';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const csrf = validateMutableRequest({
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    appOrigin: process.env.APP_ORIGIN,
    environment: process.env.NODE_ENV,
  });
  if (!csrf.ok) return mutationFailure(csrf.status);

  const form = await request.formData();
  const securityConfig = safeLoadSecurityConfig();
  if (!securityConfig) return mutationFailure(403);
  const rawTrigram = form.get('trigram');
  const securityContext = buildAuthSecurityContext({
    trigram: typeof rawTrigram === 'string' ? rawTrigram : '',
    networkOrigin: resolveTrustedNetworkOrigin({
      request,
      environment: process.env.NODE_ENV,
    }),
    userAgent: request.headers.get('user-agent'),
    config: securityConfig,
  });
  const result = await authenticateTrigram({
    rawTrigram,
    repository: new SupabaseProfileRepository(),
    securityRepository: new SupabaseAuthSecurityRepository(),
    securityConfig,
    securityContext,
    secret: process.env.SESSION_SECRET,
    environment: process.env.NODE_ENV,
  });

  if (!result.ok) {
    const url = new URL('/', request.url);
    url.searchParams.set('error', 'login');
    const response = NextResponse.redirect(url, { status: 303 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const response = NextResponse.redirect(new URL(result.redirectTo, request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, result.token, result.cookie);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function mutationFailure(status: 403) {
  const response = NextResponse.json({ error: 'Nao foi possivel processar a requisicao.' }, { status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function safeLoadSecurityConfig(): ReturnType<typeof loadAuthSecurityConfig> | null {
  try {
    return loadAuthSecurityConfig();
  } catch {
    return null;
  }
}
