import { NextResponse } from 'next/server';
import {
  runAvopNotificationJob,
  validateCronSecret,
} from '@/lib/notifications/avop-email';
import { createGmailAvopEmailSender } from '@/lib/notifications/gmail-avop-email-sender';
import { SupabaseAvopNotificationRepository } from '@/lib/notifications/supabase-avop-notification-repository';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const provided = extractCronSecret(request);
  if (!validateCronSecret({ provided, expected: process.env.CRON_SECRET })) {
    return noStore(NextResponse.json({ error: 'Nao foi possivel processar a requisicao.' }, { status: 403 }));
  }

  try {
    const dryRun = process.env.AVOP_EMAIL_MODE !== 'gmail';
    const report = await runAvopNotificationJob({
      repository: new SupabaseAvopNotificationRepository(),
      sender: createGmailAvopEmailSender(),
      baseUrl: process.env.APP_BASE_URL || process.env.APP_ORIGIN || 'http://localhost:3000',
      dryRun,
    });
    return noStore(NextResponse.json({ ok: true, dryRun, report }));
  } catch {
    return noStore(NextResponse.json({ error: 'Nao foi possivel processar a requisicao.' }, { status: 500 }));
  }
}

function extractCronSecret(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length);
  return request.headers.get('x-cron-secret');
}

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
