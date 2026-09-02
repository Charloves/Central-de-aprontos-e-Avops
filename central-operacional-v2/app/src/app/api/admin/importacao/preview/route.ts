import { NextResponse } from 'next/server';
import { validateMutableRequest } from '@/lib/auth/csrf';
import { readSession } from '@/lib/auth/server';
import {
  encodeConfirmationCookie,
  LEGACY_IMPORT_CONFIRMATION_COOKIE,
  createLegacyImportPreviewForSession,
} from '@/lib/admin/legacy-imports';
import { SupabaseLegacyImportRepository } from '@/lib/admin/supabase-legacy-import-repository';

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
    const result = await createLegacyImportPreviewForSession({
      session,
      formData: await request.formData(),
      repository: new SupabaseLegacyImportRepository(),
    });
    if (!result.ok || !result.batch.confirmationToken) return failure(request);

    const response = NextResponse.redirect(new URL(`/admin/importacao?batch=${encodeURIComponent(result.batch.batchId)}`, request.url), { status: 303 });
    response.cookies.set({
      name: LEGACY_IMPORT_CONFIRMATION_COOKIE,
      value: encodeConfirmationCookie(result.batch.batchId, result.batch.confirmationToken),
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/admin/importacao',
      maxAge: 30 * 60,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return failure(request);
  }
}

function failure(request: Request) {
  const response = NextResponse.redirect(new URL('/admin/importacao?error=preview', request.url), { status: 303 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
