export type BriefingStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

export type BriefingAttendanceStatus = 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO' | 'PENDENTE' | string;

export type BriefingAudienceCode = 'PILOTO' | 'TRIPULANTE' | 'HSAR' | 'TODOS' | string;

export type BriefingRecord = {
  id: string;
  briefingId: string;
  profileId: string;
  attendanceStatus: BriefingAttendanceStatus;
  materialAcknowledged: boolean;
  recordedAt: string;
};

export type AbsenceJustification = {
  id: string;
  briefingId: string;
  profileId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type BriefingListItem = {
  id: string;
  legacyId: string;
  title: string;
  eventDate: string | null;
  status: BriefingStatus;
  effectiveStatus: 'OPEN' | 'CLOSED';
  driveUrl: string | null;
  requiresMaterialAcknowledgement: boolean;
  audiences: BriefingAudienceCode[];
  record: BriefingRecord | null;
  latestJustification: AbsenceJustification | null;
};

export type BriefingMaterialResult =
  | { ok: true; record: BriefingRecord; alreadyAcknowledged: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_APPLICABLE' | 'UNAVAILABLE' | 'INVALID_DOCUMENT' | 'INTERNAL_ERROR' };

export type BriefingJustificationResult =
  | { ok: true; justification: AbsenceJustification }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_APPLICABLE' | 'UNAVAILABLE' | 'INVALID_TEXT' | 'INTERNAL_ERROR' };

export type BriefingRepository = {
  listApplicableBriefings(profileId: string, now?: Date): Promise<BriefingListItem[]>;
  findApplicableBriefing(profileId: string, briefingId: string, now?: Date): Promise<BriefingListItem | null>;
  acknowledgeMaterial(profileId: string, briefingId: string, now?: Date): Promise<BriefingRecord>;
  createJustification(profileId: string, briefingId: string, text: string, now?: Date): Promise<AbsenceJustification>;
};
