export type AvopStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

export type AvopAudienceCode = 'PILOTO' | 'TRIPULANTE' | 'HSAR' | 'TODOS' | string;

export type AvopAcknowledgement = {
  id: string;
  avopId: string;
  profileId: string;
  acknowledgedAt: string;
  sessionId?: string | null;
};

export type AvopListItem = {
  id: string;
  number: string;
  title: string;
  publicationDate: string;
  dueDate: string | null;
  status: AvopStatus;
  driveUrl: string | null;
  requiresAcknowledgement: boolean;
  audiences: AvopAudienceCode[];
  acknowledgement: AvopAcknowledgement | null;
};

export type AvopAcknowledgeResult =
  | { ok: true; acknowledgement: AvopAcknowledgement; alreadyAcknowledged: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_APPLICABLE' | 'UNAVAILABLE' | 'INVALID_DOCUMENT' | 'INTERNAL_ERROR' };

export type AvopRepository = {
  listApplicableAvops(profileId: string, now?: Date): Promise<AvopListItem[]>;
  findApplicableAvop(profileId: string, avopId: string, now?: Date): Promise<AvopListItem | null>;
  acknowledgeAvop(profileId: string, avopId: string, now?: Date, sessionId?: string | null): Promise<AvopAcknowledgement>;
};
