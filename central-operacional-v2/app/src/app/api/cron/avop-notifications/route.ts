import { NextResponse } from 'next/server';
import {
  runAvopNotificationJob,
  resolveAvopEmailMode,
  resolveAvopNotificationBaseUrl,
  validateCronSecret,
} from '@/lib/notifications/avop-email';
import { createGmailAvopEmailSender } from '@/lib/notifications/gmail-avop-email-sender';
import { SupabaseAvopNotificationRepository } from '@/lib/notifications/supabase-avop-notification-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}

async function handleCronRequest(request: Request) {
  const startedAt = Date.now();
  const provided = extractCronSecret(request);
  if (!validateCronSecret({ provided, expected: process.env.CRON_SECRET })) {
    return noStore(NextResponse.json({ error: 'Não foi possível processar a requisição.' }, { status: 403 }));
  }

  let executionMode: ReturnType<typeof resolveAvopEmailMode>;
  let baseUrl: string;
  try {
    executionMode = resolveAvopEmailMode({
      mode: process.env.AVOP_EMAIL_MODE,
      deliveryConfirmation: process.env.GMAIL_DELIVERY_CONFIRMATION,
    });
    baseUrl = resolveAvopNotificationBaseUrl({
      baseUrl: process.env.APP_BASE_URL,
      appOrigin: process.env.APP_ORIGIN,
      environment: process.env.NODE_ENV,
    });
  } catch {
    console.error(JSON.stringify({
      level: 'error',
      event: 'avop_notification_configuration_rejected',
      durationMs: Date.now() - startedAt,
    }));
    return noStore(NextResponse.json({ error: 'Não foi possível processar a requisição.' }, { status: 503 }));
  }

  try {
    const report = await runAvopNotificationJob({
      repository: new SupabaseAvopNotificationRepository(),
      sender: createGmailAvopEmailSender(),
      baseUrl,
      dryRun: executionMode.dryRun,
    });
    console.info(JSON.stringify({
      level: 'info',
      event: 'avop_notification_job_completed',
      mode: executionMode.mode,
      durationMs: Date.now() - startedAt,
      report,
    }));
    return noStore(NextResponse.json({ ok: true, dryRun: executionMode.dryRun, report }));
  } catch {
    console.error(JSON.stringify({
      level: 'error',
      event: 'avop_notification_job_failed',
      mode: executionMode.mode,
      durationMs: Date.now() - startedAt,
    }));
    return noStore(NextResponse.json({ error: 'Não foi possível processar a requisição.' }, { status: 500 }));
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
