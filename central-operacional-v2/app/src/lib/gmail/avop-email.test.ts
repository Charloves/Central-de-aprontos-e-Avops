import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const gmailMock = vi.hoisted(() => {
  const setCredentials = vi.fn();
  const send = vi.fn();
  const oauth2Instances: Array<{ clientId: string; clientSecret: string }> = [];
  const OAuth2 = vi.fn((clientId: string, clientSecret: string) => {
    oauth2Instances.push({ clientId, clientSecret });
    return { setCredentials };
  });
  const gmail = vi.fn(() => ({
    users: {
      messages: {
        send,
      },
    },
  }));

  return {
    OAuth2,
    gmail,
    oauth2Instances,
    send,
    setCredentials,
  };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: gmailMock.OAuth2,
    },
    gmail: gmailMock.gmail,
  },
}));

import { buildAvopReminderEmail, sendGmailMessage } from './avop-email';

const ORIGINAL_ENV = process.env;
const GENERIC_PREPARE_ERROR = 'Falha ao preparar mensagem de e-mail.';

function getDecodedRawMessage() {
  const sendInput = gmailMock.send.mock.calls[0]?.[0];
  const raw = sendInput.requestBody.raw;

  return {
    raw,
    decoded: Buffer.from(raw, 'base64url').toString('utf8'),
  };
}

function encodedWord(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

async function expectInvalidMessage(input: {
  to?: string;
  subject?: string;
  body?: string;
  senderEmail?: string;
  senderName?: string;
}) {
  if (input.senderEmail !== undefined) {
    process.env.GMAIL_SENDER_EMAIL = input.senderEmail;
  }

  if (input.senderName !== undefined) {
    process.env.GMAIL_SENDER_NAME = input.senderName;
  }

  await expect(sendGmailMessage({
    to: input.to ?? 'destinatario@example.test',
    subject: input.subject ?? 'Assunto',
    body: input.body ?? 'Corpo',
  })).rejects.toThrow(GENERIC_PREPARE_ERROR);

  expect(gmailMock.OAuth2).not.toHaveBeenCalled();
  expect(gmailMock.gmail).not.toHaveBeenCalled();
  expect(gmailMock.send).not.toHaveBeenCalled();
}

describe('avop gmail email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gmailMock.oauth2Instances.length = 0;
    gmailMock.send.mockResolvedValue({ data: { id: 'message-1' } });
    process.env = {
      ...ORIGINAL_ENV,
      GMAIL_CLIENT_ID: 'client-id-test',
      GMAIL_CLIENT_SECRET: 'client-secret-test',
      GMAIL_REFRESH_TOKEN: 'refresh-token-test',
      GMAIL_SENDER_EMAIL: 'sender@example.test',
      GMAIL_SENDER_NAME: 'Remetente Teste',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('configura OAuth2, aplica refresh token e chama endpoint de envio correto', async () => {
    await sendGmailMessage({
      to: 'destinatario@example.test',
      subject: 'Assunto de teste',
      body: 'Corpo de teste',
    });

    expect(gmailMock.OAuth2).toHaveBeenCalledWith('client-id-test', 'client-secret-test');
    expect(gmailMock.setCredentials).toHaveBeenCalledWith({ refresh_token: 'refresh-token-test' });
    expect(gmailMock.gmail).toHaveBeenCalledWith({
      version: 'v1',
      auth: expect.objectContaining({ setCredentials: gmailMock.setCredentials }),
    });
    expect(gmailMock.send).toHaveBeenCalledTimes(1);
    expect(gmailMock.send).toHaveBeenCalledWith({
      userId: 'me',
      requestBody: {
        raw: expect.any(String),
      },
    });
  });

  it('constroi mensagem em base64url sem executar chamada externa real', async () => {
    await sendGmailMessage({
      to: 'destinatario@example.test',
      subject: 'Pendencia AVOP',
      body: 'Link de ciencia',
    });

    const { decoded, raw } = getDecodedRawMessage();

    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decoded).toContain('From: Remetente Teste <sender@example.test>');
    expect(decoded).toContain('To: destinatario@example.test');
    expect(decoded).toContain('Subject: Pendencia AVOP');
    expect(decoded).toContain('MIME-Version: 1.0');
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decoded).toContain('\r\n\r\nLink de ciencia');
    expect(decoded).toContain('Link de ciencia');
    expect(gmailMock.send).toHaveBeenCalledTimes(1);
  });

  it('codifica nome e assunto com acentos usando MIME encoded-word', async () => {
    process.env.GMAIL_SENDER_NAME = 'Coordenação 1º/11º GAV';

    await sendGmailMessage({
      to: 'destinatario@example.test',
      subject: 'Pendência de ciência',
      body: 'Corpo',
    });

    const { decoded } = getDecodedRawMessage();

    expect(decoded).toContain(`From: ${encodedWord('Coordenação 1º/11º GAV')} <sender@example.test>`);
    expect(decoded).toContain(`Subject: ${encodedWord('Pendência de ciência')}`);
    expect(decoded).not.toContain('Coordenação 1º/11º GAV');
    expect(decoded).not.toContain('Pendência de ciência');
  });

  it('preserva quebras no corpo sem permitir alteracao dos cabecalhos', async () => {
    await sendGmailMessage({
      to: 'destinatario@example.test',
      subject: 'Assunto',
      body: 'Linha 1\r\nBcc: invasor@example.test\r\nLinha 3',
    });

    const { decoded } = getDecodedRawMessage();
    const [headers, body] = decoded.split('\r\n\r\n');

    expect(headers).not.toContain('Bcc:');
    expect(body).toContain('Linha 1\r\nBcc: invasor@example.test\r\nLinha 3');
  });

  it.each([
    ['senderName CR', { senderName: 'Remetente\rBcc: invasor@example.test' }],
    ['senderName LF', { senderName: 'Remetente\nBcc: invasor@example.test' }],
    ['senderEmail CR', { senderEmail: 'sender@example.test\rBcc: invasor@example.test' }],
    ['senderEmail LF', { senderEmail: 'sender@example.test\nBcc: invasor@example.test' }],
    ['to CR', { to: 'destinatario@example.test\rBcc: invasor@example.test' }],
    ['to LF', { to: 'destinatario@example.test\nBcc: invasor@example.test' }],
    ['subject CR', { subject: 'Assunto\rBcc: invasor@example.test' }],
    ['subject LF', { subject: 'Assunto\nBcc: invasor@example.test' }],
  ])('rejeita quebra de cabecalho em %s', async (_caseName, input) => {
    await expectInvalidMessage(input);
  });

  it.each([
    ['senderName NUL', { senderName: 'Remetente\u0000Teste' }],
    ['senderName controle', { senderName: 'Remetente\u001FTeste' }],
    ['senderEmail NUL', { senderEmail: 'sender@example.test\u0000' }],
    ['to controle', { to: 'destinatario@example.test\u001F' }],
    ['subject controle', { subject: 'Assunto\u007F' }],
  ])('rejeita NUL e caracteres de controle em %s', async (_caseName, input) => {
    await expectInvalidMessage(input);
  });

  it.each([
    ['Bcc no destinatario', { to: 'destinatario@example.test Bcc: invasor@example.test' }],
    ['Cc no remetente', { senderEmail: 'sender@example.test Cc: invasor@example.test' }],
    ['cabecalho arbitrario no assunto', { subject: 'Assunto\r\nX-Teste: valor' }],
    ['display name no destinatario', { to: 'Nome <destinatario@example.test>' }],
    ['multiplos por virgula', { to: 'destinatario@example.test,outro@example.test' }],
    ['multiplos por ponto e virgula', { to: 'destinatario@example.test;outro@example.test' }],
    ['email sem arroba', { to: 'destinatario.example.test' }],
    ['email sem dominio valido', { to: 'destinatario@example' }],
    ['remetente com nome de exibicao', { senderEmail: 'Remetente <sender@example.test>' }],
  ])('rejeita sintaxe de email insegura: %s', async (_caseName, input) => {
    await expectInvalidMessage(input);
  });

  it('retorna erro generico sem ecoar entrada maliciosa', async () => {
    const malicious = 'Assunto\r\nBcc: invasor@example.test';

    await expect(sendGmailMessage({
      to: 'destinatario@example.test',
      subject: malicious,
      body: 'Corpo',
    })).rejects.not.toThrow(malicious);

    await expect(sendGmailMessage({
      to: 'destinatario@example.test',
      subject: malicious,
      body: 'Corpo',
    })).rejects.toThrow(GENERIC_PREPARE_ERROR);

    expect(gmailMock.OAuth2).not.toHaveBeenCalled();
    expect(gmailMock.send).not.toHaveBeenCalled();
  });

  it('monta texto de cobranca com um link para cada AVOP', () => {
    const email = buildAvopReminderEmail([
      { avopNumber: 'AVOP 01-2026', title: 'Aviso um', acknowledgementUrl: 'https://example.test/avop-1' },
      { avopNumber: 'AVOP 02-2026', title: 'Aviso dois', acknowledgementUrl: 'https://example.test/avop-2' },
    ]);

    expect(email.subject).toContain('(2)');
    expect(email.body).toContain('AVOP 01-2026 - Aviso um');
    expect(email.body).toContain('https://example.test/avop-1');
    expect(email.body).toContain('AVOP 02-2026 - Aviso dois');
    expect(email.body).toContain('https://example.test/avop-2');
  });

  it('falha de forma segura quando credenciais obrigatorias estao ausentes', async () => {
    delete process.env.GMAIL_CLIENT_SECRET;

    await expect(sendGmailMessage({
      to: 'destinatario@example.test',
      subject: 'Assunto',
      body: 'Corpo',
    })).rejects.toThrow('Credenciais da Gmail API');

    expect(gmailMock.OAuth2).not.toHaveBeenCalled();
    expect(gmailMock.gmail).not.toHaveBeenCalled();
    expect(gmailMock.send).not.toHaveBeenCalled();
  });

  it('oculta detalhes e segredos quando a API retorna erro', async () => {
    gmailMock.send.mockRejectedValueOnce(new Error('erro remoto com client-secret-test'));

    await expect(sendGmailMessage({
      to: 'destinatario@example.test',
      subject: 'Assunto',
      body: 'Corpo',
    })).rejects.toThrow('Falha ao enviar mensagem pela Gmail API.');

    await expect(sendGmailMessage({
      to: 'destinatario@example.test',
      subject: 'Assunto',
      body: 'Corpo',
    })).resolves.toEqual({ data: { id: 'message-1' } });
  });
});
