import { NextResponse } from 'next/server';
import { validateCronSecret } from '@/lib/notifications/avop-email';
import { SupabaseAvopNotificationRepository } from '@/lib/notifications/supabase-avop-notification-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization');
  const provided = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : null;
  if (!validateCronSecret({ provided, expected: process.env.CRON_SECRET })) {
    return noStore(NextResponse.json({ error: 'Não foi possível processar a requisição.' }, { status: 403 }));
  }

  try {
    const health = await new SupabaseAvopNotificationRepository().getHealth();
    return noStore(NextResponse.json(
      { ok: true, health },
      { status: health.status === 'degraded' ? 503 : 200 },
    ));
  } catch {
    return noStore(NextResponse.json({ error: 'Não foi possível processar a requisição.' }, { status: 503 }));
  }
}

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
