import { hasAudienceIntersection } from './rules';
import type { AvopAcknowledgement, AvopListItem, AvopRepository } from './types';

export type FakeAvopProfile = {
  id: string;
  active: boolean;
  audiences: string[];
};

export class FakeAvopRepository implements AvopRepository {
  private readonly profiles = new Map<string, FakeAvopProfile>();
  private readonly avops = new Map<string, AvopListItem>();
  private readonly acknowledgements = new Map<string, AvopAcknowledgement>();
  acknowledgementWrites = 0;

  constructor(input: {
    profiles: FakeAvopProfile[];
    avops: AvopListItem[];
    acknowledgements?: AvopAcknowledgement[];
  }) {
    input.profiles.forEach((profile) => this.profiles.set(profile.id, profile));
    input.avops.forEach((avop) => this.avops.set(avop.id, { ...avop }));
    input.acknowledgements?.forEach((acknowledgement) => {
      this.acknowledgements.set(key(acknowledgement.profileId, acknowledgement.avopId), acknowledgement);
    });
  }

  async listApplicableAvops(profileId: string): Promise<AvopListItem[]> {
    const profile = this.profiles.get(profileId);
    if (!profile?.active) return [];

    return [...this.avops.values()]
      .filter((avop) => avop.status === 'PUBLISHED')
      .filter((avop) => hasAudienceIntersection(profile.audiences, avop.audiences))
      .map((avop) => this.withAcknowledgement(profileId, avop))
      .sort((a, b) => b.publicationDate.localeCompare(a.publicationDate) || a.number.localeCompare(b.number));
  }

  async findApplicableAvop(profileId: string, avopId: string): Promise<AvopListItem | null> {
    const profile = this.profiles.get(profileId);
    const avop = this.avops.get(avopId);
    if (!profile?.active || !avop || avop.status !== 'PUBLISHED') return null;
    if (!hasAudienceIntersection(profile.audiences, avop.audiences)) return null;
    return this.withAcknowledgement(profileId, avop);
  }

  async acknowledgeAvop(profileId: string, avopId: string, now: Date = new Date()): Promise<AvopAcknowledgement> {
    const acknowledgementKey = key(profileId, avopId);
    const existing = this.acknowledgements.get(acknowledgementKey);
    if (existing) return existing;

    const created: AvopAcknowledgement = {
      id: `ack-${this.acknowledgements.size + 1}`,
      avopId,
      profileId,
      acknowledgedAt: now.toISOString(),
    };
    this.acknowledgementWrites += 1;
    this.acknowledgements.set(acknowledgementKey, created);
    return created;
  }

  private withAcknowledgement(profileId: string, avop: AvopListItem): AvopListItem {
    return {
      ...avop,
      acknowledgement: this.acknowledgements.get(key(profileId, avop.id)) ?? avop.acknowledgement,
    };
  }
}

function key(profileId: string, avopId: string): string {
  return `${profileId}:${avopId}`;
}
