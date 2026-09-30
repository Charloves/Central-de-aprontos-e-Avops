import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCandidates: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/lib/notifications/supabase-avop-notification-repository', () => ({
  SupabaseAvopNotificationRepository: class {
    listCandidates = mocks.listCandidates;
  },
}));

vi.mock('@/lib/notifications/gmail-avop-email-sender', () => ({
  createGmailAvopEmailSender: () => ({ send: mocks.send }),
}));

import { GET } from './route';

const secret = '0123456789abcdef0123456789abcdef';

describe('AVOP notification cron route', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.CRON_SECRET = secret;
    process.env.APP_BASE_URL = 'https://central.example.test';
    process.env.AVOP_EMAIL_MODE = 'dry-run';
    delete process.env.GMAIL_DELIVERY_CONFIRMATION;
    mocks.listCandidates.mockReset().mockResolvedValue([]);
    mocks.send.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.CRON_SECRET;
    delete process.env.APP_BASE_URL;
    delete process.env.AVOP_EMAIL_MODE;
    delete process.env.GMAIL_DELIVERY_CONFIRMATION;
  });

  it('nega segredo invalido antes de consultar candidatos', async () => {
    const response = await GET(new Request('https://central.example.test/api/cron/avop-notifications'));

    expect(response.status).toBe(403);
    expect(mocks.listCandidates).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('falha fechado sem o segundo gate do Gmail antes de consultar candidatos', async () => {
    process.env.AVOP_EMAIL_MODE = 'gmail';
    const response = await GET(authorizedRequest());

    expect(response.status).toBe(503);
    expect(mocks.listCandidates).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('executa dry-run sem chamar Gmail', async () => {
    const response = await GET(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({ ok: true, dryRun: true });
    expect(mocks.listCandidates).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

function authorizedRequest() {
  return new Request('https://central.example.test/api/cron/avop-notifications', {
    headers: { authorization: `Bearer ${secret}` },
  });
}
