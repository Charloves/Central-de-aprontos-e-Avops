import { google } from 'googleapis';

export type AvopEmailItem = {
  avopNumber: string;
  title: string;
  acknowledgementUrl: string;
};

export function buildAvopReminderEmail(items: AvopEmailItem[]) {
  const subject = items.length === 1
    ? 'Pendência de ciência de AVOP - 1º/11º GAV'
    : `Pendências de ciência de AVOP (${items.length}) - 1º/11º GAV`;

  const body = [
    'Caro tripulante,',
    '',
    'Constam pendências de ciência nos AVOPs abaixo:',
    '',
    ...items.flatMap((item, index) => [
      `${index + 1}. ${item.avopNumber} - ${item.title}`,
      'Link para registrar ciência:',
      item.acknowledgementUrl,
      '',
    ]),
    'Assim que a ciência for registrada, o respectivo AVOP deixará de constar nas próximas cobranças automáticas.',
    '',
    'CDOUT - 1º/11º GAV',
    'Lembrete automático do sistema de controle de AVOPs.',
  ].join('\n');

  return { subject, body };
}

export async function sendGmailMessage(input: {
  to: string;
  subject: string;
  body: string;
}) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const senderEmail = process.env.GMAIL_SENDER_EMAIL || 'cdout.1gav11@gmail.com';
  const senderName = process.env.GMAIL_SENDER_NAME || 'CDOUT - 1º/11º GAV';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Credenciais da Gmail API não configuradas.');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = Buffer.from([
    `From: ${senderName} <${senderEmail}>`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    input.body,
  ].join('\r\n')).toString('base64url');

  return gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
}
