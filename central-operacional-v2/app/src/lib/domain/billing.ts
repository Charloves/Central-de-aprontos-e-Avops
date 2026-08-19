const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type BillingStopReason =
  | 'ACKNOWLEDGED'
  | 'AVOP_CLOSED'
  | 'PROFILE_INACTIVE'
  | 'NOT_APPLICABLE'
  | 'EXPIRED_365_DAYS';

export type BillingDecision =
  | { shouldSend: true; nextSendAt: Date; marker: string }
  | { shouldSend: false; nextSendAt: Date | null; stopReason?: BillingStopReason; marker?: string };

export function stripTime(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function daysBetween(start: Date, end: Date): number {
  return Math.floor((stripTime(end).getTime() - stripTime(start).getTime()) / MS_PER_DAY);
}

export function addDays(date: Date, days: number): Date {
  const copy = stripTime(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(date: Date, months: number): Date {
  const copy = stripTime(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

export function nextAvopBillingDate(publicationDate: Date, referenceDate: Date): Date | null {
  const ageDays = daysBetween(publicationDate, referenceDate);
  if (ageDays >= 365) return null;

  if (ageDays < 30) {
    const nextWeeklyMarker = Math.floor(ageDays / 7) + 1;
    return addDays(publicationDate, nextWeeklyMarker * 7);
  }

  const monthlyReference = addDays(publicationDate, 30);
  const monthsElapsed = Math.max(0, Math.floor(daysBetween(monthlyReference, referenceDate) / 30));
  return addMonths(monthlyReference, monthsElapsed + 1);
}

export function decideAvopBilling(input: {
  publicationDate: Date;
  today: Date;
  alreadyAcknowledged: boolean;
  avopClosed: boolean;
  profileActive: boolean;
  applicable: boolean;
  alreadySentMarkers: string[];
}): BillingDecision {
  if (input.alreadyAcknowledged) return { shouldSend: false, nextSendAt: null, stopReason: 'ACKNOWLEDGED' };
  if (input.avopClosed) return { shouldSend: false, nextSendAt: null, stopReason: 'AVOP_CLOSED' };
  if (!input.profileActive) return { shouldSend: false, nextSendAt: null, stopReason: 'PROFILE_INACTIVE' };
  if (!input.applicable) return { shouldSend: false, nextSendAt: null, stopReason: 'NOT_APPLICABLE' };

  const ageDays = daysBetween(input.publicationDate, input.today);
  if (ageDays >= 365) return { shouldSend: false, nextSendAt: null, stopReason: 'EXPIRED_365_DAYS' };

  const marker = ageDays < 30
    ? `WEEK_${Math.floor(ageDays / 7)}`
    : `MONTH_${Math.max(1, Math.floor((ageDays - 30) / 30) + 1)}`;

  if (ageDays < 7 || input.alreadySentMarkers.includes(marker)) {
    return { shouldSend: false, nextSendAt: nextAvopBillingDate(input.publicationDate, input.today), marker };
  }

  return {
    shouldSend: true,
    nextSendAt: nextAvopBillingDate(input.publicationDate, input.today) ?? addDays(input.today, 30),
    marker,
  };
}
