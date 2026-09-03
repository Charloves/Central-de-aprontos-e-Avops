import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { validateMutableRequest } from '@/lib/auth/csrf';
import { readSession } from '@/lib/auth/server';
import {
  applyLegacyImportForSession,
  decodeConfirmationCookie,
  LEGACY_IMPORT_CONFIRMATION_COOKIE,
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
    const formData = await request.formData();
    const batchId = String(formData.get('batchId') ?? '');
    const cookieStore = await cookies();
    const token = decodeConfirmationCookie(cookieStore.get(LEGACY_IMPORT_CONFIRMATION_COOKIE)?.value, batchId);
    const result = await applyLegacyImportForSession({
      session,
      formData,
      confirmationToken: token,
      repository: new SupabaseLegacyImportRepository(),
    });
    if (!result.ok) return failure(request);

    const response = NextResponse.redirect(new URL('/admin/importacao?applied=1', request.url), { status: 303 });
    response.cookies.delete(LEGACY_IMPORT_CONFIRMATION_COOKIE);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return failure(request);
  }
}

function failure(request: Request) {
  const response = NextResponse.redirect(new URL('/admin/importacao?error=apply', request.url), { status: 303 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
