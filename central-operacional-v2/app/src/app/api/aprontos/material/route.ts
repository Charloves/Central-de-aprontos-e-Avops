import { NextResponse } from 'next/server';
import { validateMutableRequest } from '@/lib/auth/csrf';
import { readSession } from '@/lib/auth/server';
import { acknowledgeBriefingMaterialForSession, extractBriefingMaterialId } from '@/lib/briefings/service';
import { SupabaseBriefingRepository } from '@/lib/briefings/supabase-briefing-repository';

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
    const briefingId = await extractBriefingMaterialId(await request.formData());
    const result = await acknowledgeBriefingMaterialForSession({
      session,
      briefingId,
      repository: new SupabaseBriefingRepository(),
    });
    if (!result.ok) return failure(request);
  } catch {
    return failure(request);
  }

  const response = NextResponse.redirect(new URL('/portal/aprontos?material=ok', request.url), { status: 303 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function failure(request: Request) {
  const response = NextResponse.redirect(new URL('/portal/aprontos?error=material', request.url), { status: 303 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
