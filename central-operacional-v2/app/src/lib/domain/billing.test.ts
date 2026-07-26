import { describe, expect, it } from 'vitest';
import { decideAvopBilling, nextAvopBillingDate } from './billing';

describe('billing', () => {
  const publicationDate = new Date('2026-04-22T00:00:00Z');

  it('nao cobra antes de 7 dias', () => {
    const decision = decideAvopBilling({
      publicationDate,
      today: new Date('2026-04-27T00:00:00Z'),
      alreadyAcknowledged: false,
      avopClosed: false,
      profileActive: true,
      applicable: true,
      alreadySentMarkers: [],
    });
    expect(decision.shouldSend).toBe(false);
  });

  it('cobra semanalmente nos primeiros 30 dias', () => {
    const decision = decideAvopBilling({
      publicationDate,
      today: new Date('2026-05-06T00:00:00Z'),
      alreadyAcknowledged: false,
      avopClosed: false,
      profileActive: true,
      applicable: true,
      alreadySentMarkers: [],
    });
    expect(decision).toMatchObject({ shouldSend: true, marker: 'WEEK_2' });
  });

  it('passa para marco mensal apos 30 dias', () => {
    const decision = decideAvopBilling({
      publicationDate,
      today: new Date('2026-06-01T00:00:00Z'),
      alreadyAcknowledged: false,
      avopClosed: false,
      profileActive: true,
      applicable: true,
      alreadySentMarkers: [],
    });
    expect(decision).toMatchObject({ shouldSend: true, marker: 'MONTH_1' });
  });

  it('cessa quando ha ciencia', () => {
    const decision = decideAvopBilling({
      publicationDate,
      today: new Date('2026-06-01T00:00:00Z'),
      alreadyAcknowledged: true,
      avopClosed: false,
      profileActive: true,
      applicable: true,
      alreadySentMarkers: [],
    });
    expect(decision).toMatchObject({ shouldSend: false, stopReason: 'ACKNOWLEDGED' });
  });

  it('nao agenda depois de 365 dias', () => {
    expect(nextAvopBillingDate(publicationDate, new Date('2027-04-23T00:00:00Z'))).toBeNull();
  });
});
