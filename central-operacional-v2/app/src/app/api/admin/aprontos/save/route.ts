import { NextResponse } from 'next/server';
import { validateMutableRequest } from '@/lib/auth/csrf';
import { readSession } from '@/lib/auth/server';
import { saveBriefingDraftForSession } from '@/lib/admin/publications';
import { SupabasePublicationRepository } from '@/lib/admin/supabase-publication-repository';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const csrf = validateMutableRequest({
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    appOrigin: process.env.APP_ORIGIN,
    environment: process.env.NODE_ENV,
  });
  if (!csrf.ok) return failure(request, 'save');

  const session = await readSession();
  if (!session) return failure(request, 'save');

  try {
    const result = await saveBriefingDraftForSession({
      session,
      formData: await request.formData(),
      repository: new SupabasePublicationRepository(),
    });
    if (!result.ok) return failure(request, 'save');
    return redirectNoStore(new URL(`/admin/aprontos/novo?id=${encodeURIComponent(result.id)}&saved=1`, request.url));
  } catch {
    return failure(request, 'save');
  }
}

function failure(request: Request, code: string) {
  return redirectNoStore(new URL(`/admin/aprontos/novo?error=${code}`, request.url));
}

function redirectNoStore(url: URL) {
  const response = NextResponse.redirect(url, { status: 303 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
