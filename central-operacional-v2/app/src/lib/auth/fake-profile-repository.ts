import { normalizeTrigram } from '@/lib/domain/normalization';
import type { AuthProfile, ProfileRepository } from './profiles';

export class FakeProfileRepository implements ProfileRepository {
  private readonly profiles: Map<string, AuthProfile>;

  constructor(profiles: AuthProfile[]) {
    this.profiles = new Map(profiles.map((profile) => [normalizeTrigram(profile.trigram), profile]));
  }

  setProfile(profile: AuthProfile): void {
    this.profiles.set(normalizeTrigram(profile.trigram), profile);
  }

  async findByTrigram(trigram: string): Promise<AuthProfile | null> {
    return this.profiles.get(normalizeTrigram(trigram)) ?? null;
  }
}
