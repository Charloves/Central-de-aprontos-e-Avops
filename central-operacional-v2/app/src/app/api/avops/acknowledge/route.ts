import { NextResponse } from 'next/server';
import { validateMutableRequest } from '@/lib/auth/csrf';
import { readSession } from '@/lib/auth/server';
import { SupabaseAvopRepository } from '@/lib/avops/supabase-avop-repository';
import { acknowledgeAvopForSession, extractAcknowledgeAvopId } from '@/lib/avops/service';

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
    const avopId = await extractAcknowledgeAvopId(await request.formData());
    const result = await acknowledgeAvopForSession({
      session,
      avopId,
      repository: new SupabaseAvopRepository(),
    });

    if (!result.ok) return failure(request);
  } catch {
    return failure(request);
  }

  const response = NextResponse.redirect(new URL('/portal/avops?ack=ok', request.url), { status: 303 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function failure(request: Request) {
  const response = NextResponse.redirect(new URL('/portal/avops?error=ack', request.url), {
    status: 303,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
