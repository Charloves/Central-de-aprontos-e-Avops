import 'server-only';

import { google } from 'googleapis';

export type AvopEmailItem = {
  avopNumber: string;
  title: string;
  acknowledgementUrl: string;
};

export function buildAvopReminderEmail(items: AvopEmailItem[]) {
  const subject = items.length === 1
    ? 'Central Operacional — pendência de ciência de AVOP'
    : `Central Operacional — pendências de ciência de AVOP (${items.length})`;

  const body = [
    'Prezado(a),',
    '',
    items.length === 1
      ? 'Consta pendente o registro de ciência do AVOP abaixo:'
      : 'Constam pendentes os registros de ciência dos AVOPs abaixo:',
    '',
    ...items.flatMap((item, index) => [
      `${index + 1}. ${item.avopNumber} — ${item.title}`,
      'Acesse a Central Operacional para realizar a leitura e registrar sua ciência:',
      item.acknowledgementUrl,
      '',
    ]),
    'A abertura do documento não registra ciência automaticamente. Após a leitura, utilize o campo próprio da Central para confirmar a ciência.',
    '',
    'Caso a ciência já tenha sido registrada, desconsidere esta mensagem.',
    '',
    'Esta é uma mensagem automática da Central Operacional.',
  ].join('\n');

  return { subject, body };
}

const HEADER_CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;
const SIMPLE_EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function rejectUnsafeHeaderValue(value: string) {
  if (HEADER_CONTROL_CHAR_PATTERN.test(value)) {
    throw new Error('Falha ao preparar mensagem de e-mail.');
  }
}

function formatSimpleEmailAddress(value: string) {
  rejectUnsafeHeaderValue(value);

  if (
    value.trim() !== value
    || value.includes(' ')
    || value.includes(',')
    || value.includes(';')
    || !SIMPLE_EMAIL_PATTERN.test(value)
  ) {
    throw new Error('Falha ao preparar mensagem de e-mail.');
  }

  return value;
}

function encodeMimeHeaderValue(value: string) {
  rejectUnsafeHeaderValue(value);

  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }

  const chunks: string[] = [];
  let current = '';

  for (const character of value) {
    const candidate = current + character;
    if (current && Buffer.byteLength(candidate, 'utf8') > 45) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
    .join(' ');
}

function formatDisplayName(value: string) {
  rejectUnsafeHeaderValue(value);

  if (/[<>]/.test(value)) {
    throw new Error('Falha ao preparar mensagem de e-mail.');
  }

  return encodeMimeHeaderValue(value);
}

function encodeMimeBody(value: string) {
  return Buffer.from(value, 'utf8').toString('base64');
}

export async function sendGmailMessage(input: {
  to: string;
  subject: string;
  body: string;
}) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const senderEmail = process.env.GMAIL_SENDER_EMAIL;
  const senderName = process.env.GMAIL_SENDER_NAME;

  if (!clientId || !clientSecret || !refreshToken || !senderEmail || !senderName) {
    throw new Error('Credenciais da Gmail API não configuradas.');
  }

  const safeSenderEmail = formatSimpleEmailAddress(senderEmail);
  const safeRecipientEmail = formatSimpleEmailAddress(input.to);
  const safeSenderName = formatDisplayName(senderName);
  const safeSubject = encodeMimeHeaderValue(input.subject);

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = Buffer.from([
    `From: ${safeSenderName} <${safeSenderEmail}>`,
    `To: ${safeRecipientEmail}`,
    `Subject: ${safeSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(input.body),
  ].join('\r\n')).toString('base64url');

  try {
    return await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
  } catch {
    throw new Error('Falha ao enviar mensagem pela Gmail API.');
  }
}
