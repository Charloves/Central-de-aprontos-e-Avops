import 'server-only';

import { sendGmailMessage } from '@/lib/gmail/avop-email';
import type { AvopEmailSender } from './avop-email';

export function createGmailAvopEmailSender(): AvopEmailSender {
  return {
    async send(input) {
      const result = await sendGmailMessage(input);
      const data = result.data as { id?: string };
      return { providerMessageId: data.id ?? null };
    },
  };
}
