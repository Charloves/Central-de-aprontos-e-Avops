export type Role = 'USER' | 'COORDINATOR' | 'ADMIN';

export type AudienceCode = 'PILOTO' | 'TRIPULANTE' | 'HSAR' | 'TODOS' | string;

export type ActivityStatus = 'DRAFT' | 'PUBLISHED' | 'ACTIVE' | 'OPEN' | 'CLOSED';

export type Avop = {
  id: string;
  number: string;
  title: string;
  publicationDate: Date;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  audiences: AudienceCode[];
  requiresAcknowledgement: boolean;
};

export type Profile = {
  id: string;
  trigram: string;
  name: string;
  email: string;
  active: boolean;
  roles: Role[];
  audiences: AudienceCode[];
};

export type NotificationSchedule = {
  activityType: 'AVOP';
  activityId: string;
  profileId: string;
  publicationDate: Date;
  lastSentAt: Date | null;
  nextSendAt: Date | null;
  sendCount: number;
  status: 'ACTIVE' | 'STOPPED';
};

export type OiRecord = {
  aircraft: 'H50' | 'H125';
  oiKey: string;
  program: string;
  subprogram: string;
  phaseId: string;
  title: string;
  driveUrl: string;
  driveFileId: string | null;
  startPage: number;
  endPage: number | null;
  displayKey: string;
  missionCodes: string[];
  active: boolean;
};
