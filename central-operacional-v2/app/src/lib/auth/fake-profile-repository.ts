import { normalizeTrigram } from '@/lib/domain/normalization';
import type { AuthProfile, ProfileRepository } from './profiles';

export class FakeProfileRepository implements ProfileRepository {
  private readonly profiles: Map<string, AuthProfile>;
  private readonly profilesById: Map<string, AuthProfile>;

  constructor(profiles: AuthProfile[]) {
    this.profiles = new Map(profiles.map((profile) => [normalizeTrigram(profile.trigram), profile]));
    this.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  }

  setProfile(profile: AuthProfile): void {
    this.profiles.set(normalizeTrigram(profile.trigram), profile);
    this.profilesById.set(profile.id, profile);
  }

  async findByTrigram(trigram: string): Promise<AuthProfile | null> {
    return this.profiles.get(normalizeTrigram(trigram)) ?? null;
  }

  async findById(profileId: string): Promise<AuthProfile | null> {
    return this.profilesById.get(profileId) ?? null;
  }
}
