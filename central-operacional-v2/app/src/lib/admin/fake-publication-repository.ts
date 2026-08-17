import type {
  AdminAudience,
  AdminAvopDraft,
  AdminBriefingDraft,
  AdminPublicationPayload,
  AdminPublicationRepository,
  AdminPublicationResult,
  AdminPublicationSnapshot,
  PublicationAudienceCode,
} from './publications';

type FakeProfile = {
  id: string;
  active: boolean;
  audiences: PublicationAudienceCode[];
};

export class FakePublicationRepository implements AdminPublicationRepository {
  readonly audiences: AdminAudience[] = [
    { id: 'aud-piloto', code: 'PILOTO', name: 'Piloto' },
    { id: 'aud-tripulante', code: 'TRIPULANTE', name: 'Tripulante' },
    { id: 'aud-hsar', code: 'HSAR', name: 'HSAR' },
    { id: 'aud-todos', code: 'TODOS', name: 'Todos' },
  ];

  readonly profiles: FakeProfile[] = [
    { id: 'profile-piloto', active: true, audiences: ['PILOTO'] },
    { id: 'profile-tripulante', active: true, audiences: ['TRIPULANTE'] },
    { id: 'profile-hsar', active: true, audiences: ['HSAR'] },
    { id: 'profile-misto', active: true, audiences: ['PILOTO', 'HSAR'] },
    { id: 'profile-inativo', active: false, audiences: ['PILOTO'] },
  ];

  readonly avops = new Map<string, AdminAvopDraft>();
  readonly briefings = new Map<string, AdminBriefingDraft>();
  readonly avopMembers = new Map<string, Array<{ profileId: string; audience: PublicationAudienceCode }>>();
  readonly briefingMembers = new Map<string, Array<{ profileId: string; audience: PublicationAudienceCode }>>();
  readonly auditEvents: Array<{ action: string; entityId: string; actorProfileId: string }> = [];

  private nextId = 1;

  async listAudiences(): Promise<AdminAudience[]> {
    return [...this.audiences];
  }

  async listAvops(): Promise<AdminAvopDraft[]> {
    return [...this.avops.values()];
  }

  async findAvop(id: string): Promise<AdminAvopDraft | null> {
    return this.avops.get(id) ?? null;
  }

  async saveAvopDraft(input: {
    actorProfileId: string;
    draftId: string | null;
    payload: AdminPublicationPayload;
    now?: Date;
  }): Promise<AdminPublicationResult> {
    const existing = input.draftId ? this.avops.get(input.draftId) : null;
    if (input.draftId && !existing) return { ok: false, reason: 'NOT_FOUND' };
    if (existing && existing.status !== 'DRAFT') return { ok: false, reason: 'NOT_EDITABLE' };

    const id = existing?.id ?? this.makeId();
    const draft: AdminAvopDraft = {
      id,
      number: input.payload.number ?? '',
      title: input.payload.title,
      publicationDate: input.payload.publication_date ?? '',
      driveUrl: input.payload.drive_url,
      driveFileId: input.payload.drive_file_id,
      requiresAcknowledgement: input.payload.requires_acknowledgement ?? true,
      status: 'DRAFT',
      audiences: input.payload.audiences,
      snapshot: existing?.snapshot ?? null,
    };
    this.avops.set(id, draft);
    if (!existing) this.auditEvents.push({ action: 'AVOP_DRAFT_CREATED', entityId: id, actorProfileId: input.actorProfileId });
    return { ok: true, id };
  }

  async publishAvop(input: {
    actorProfileId: string;
    avopId: string;
    now?: Date;
  }): Promise<AdminPublicationResult> {
    const draft = this.avops.get(input.avopId);
    if (!draft) return { ok: false, reason: 'NOT_FOUND' };
    if (draft.status === 'PUBLISHED' && draft.snapshot) {
      return {
        ok: true,
        id: draft.id,
        snapshotId: draft.snapshot.id,
        applicableProfileCount: draft.snapshot.applicableProfileCount,
        alreadyPublished: true,
      };
    }
    if (draft.status !== 'DRAFT') return { ok: false, reason: 'NOT_EDITABLE' };
    if (draft.audiences.length === 0) return { ok: false, reason: 'NO_AUDIENCE' };

    const members = this.resolveMembers(draft.audiences);
    if (new Set(members.map((member) => member.profileId)).size === 0) return { ok: false, reason: 'NO_APPLICABLE_PROFILES' };

    const snapshot = makeSnapshot(input.now, members);
    draft.status = 'PUBLISHED';
    draft.snapshot = snapshot;
    this.avopMembers.set(draft.id, members);
    this.auditEvents.push({ action: 'AVOP_PUBLISHED', entityId: draft.id, actorProfileId: input.actorProfileId });
    return { ok: true, id: draft.id, snapshotId: snapshot.id, applicableProfileCount: snapshot.applicableProfileCount, alreadyPublished: false };
  }

  async listBriefings(): Promise<AdminBriefingDraft[]> {
    return [...this.briefings.values()];
  }

  async findBriefing(id: string): Promise<AdminBriefingDraft | null> {
    return this.briefings.get(id) ?? null;
  }

  async saveBriefingDraft(input: {
    actorProfileId: string;
    draftId: string | null;
    payload: AdminPublicationPayload;
    now?: Date;
  }): Promise<AdminPublicationResult> {
    const existing = input.draftId ? this.briefings.get(input.draftId) : null;
    if (input.draftId && !existing) return { ok: false, reason: 'NOT_FOUND' };
    if (existing && existing.status !== 'DRAFT') return { ok: false, reason: 'NOT_EDITABLE' };

    const id = existing?.id ?? this.makeId();
    const draft: AdminBriefingDraft = {
      id,
      legacyId: input.payload.legacy_id ?? '',
      title: input.payload.title,
      eventDate: input.payload.event_date ?? '',
      driveUrl: input.payload.drive_url,
      driveFileId: input.payload.drive_file_id,
      requiresMaterialAcknowledgement: input.payload.requires_material_acknowledgement ?? false,
      status: 'DRAFT',
      audiences: input.payload.audiences,
      snapshot: existing?.snapshot ?? null,
    };
    this.briefings.set(id, draft);
    if (!existing) this.auditEvents.push({ action: 'BRIEFING_DRAFT_CREATED', entityId: id, actorProfileId: input.actorProfileId });
    return { ok: true, id };
  }

  async publishBriefing(input: {
    actorProfileId: string;
    briefingId: string;
    now?: Date;
  }): Promise<AdminPublicationResult> {
    const draft = this.briefings.get(input.briefingId);
    if (!draft) return { ok: false, reason: 'NOT_FOUND' };
    if (draft.status === 'OPEN' && draft.snapshot) {
      return {
        ok: true,
        id: draft.id,
        snapshotId: draft.snapshot.id,
        applicableProfileCount: draft.snapshot.applicableProfileCount,
        alreadyPublished: true,
      };
    }
    if (draft.status !== 'DRAFT') return { ok: false, reason: 'NOT_EDITABLE' };
    if (draft.audiences.length === 0) return { ok: false, reason: 'NO_AUDIENCE' };

    const members = this.resolveMembers(draft.audiences);
    if (new Set(members.map((member) => member.profileId)).size === 0) return { ok: false, reason: 'NO_APPLICABLE_PROFILES' };

    const snapshot = makeSnapshot(input.now, members);
    draft.status = 'OPEN';
    draft.snapshot = snapshot;
    this.briefingMembers.set(draft.id, members);
    this.auditEvents.push({ action: 'BRIEFING_PUBLISHED', entityId: draft.id, actorProfileId: input.actorProfileId });
    return { ok: true, id: draft.id, snapshotId: snapshot.id, applicableProfileCount: snapshot.applicableProfileCount, alreadyPublished: false };
  }

  private resolveMembers(audiences: PublicationAudienceCode[]): Array<{ profileId: string; audience: PublicationAudienceCode }> {
    const members: Array<{ profileId: string; audience: PublicationAudienceCode }> = [];
    for (const profile of this.profiles.filter((candidate) => candidate.active)) {
      for (const audience of audiences) {
        if (audience === 'TODOS' || profile.audiences.includes(audience)) {
          members.push({ profileId: profile.id, audience });
        }
      }
    }
    return members;
  }

  private makeId(): string {
    return `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
  }
}

function makeSnapshot(now: Date | undefined, members: Array<{ profileId: string; audience: PublicationAudienceCode }>): AdminPublicationSnapshot {
  return {
    id: `snapshot-${now?.getTime() ?? Date.now()}`,
    publishedAt: (now ?? new Date()).toISOString(),
    applicableProfileCount: new Set(members.map((member) => member.profileId)).size,
  };
}
