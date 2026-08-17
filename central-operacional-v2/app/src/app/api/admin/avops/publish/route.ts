import { NextResponse } from 'next/server';
import { validateMutableRequest } from '@/lib/auth/csrf';
import { readSession } from '@/lib/auth/server';
import { publishAvopForSession } from '@/lib/admin/publications';
import { SupabasePublicationRepository } from '@/lib/admin/supabase-publication-repository';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const csrf = validateMutableRequest({
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    appOrigin: process.env.APP_ORIGIN,
    environment: process.env.NODE_ENV,
  });
  if (!csrf.ok) return failure(request);

  const session = await readSession();
  if (!session) return failure(request);

  try {
    const result = await publishAvopForSession({
      session,
      formData: await request.formData(),
      repository: new SupabasePublicationRepository(),
    });
    if (!result.ok) return failure(request);
    return redirectNoStore(new URL('/admin/avops?published=1', request.url));
  } catch {
    return failure(request);
  }
}

function failure(request: Request) {
  return redirectNoStore(new URL('/admin/avops?error=publish', request.url));
}

function redirectNoStore(url: URL) {
  const response = NextResponse.redirect(url, { status: 303 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
