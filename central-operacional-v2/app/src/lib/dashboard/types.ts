export type DashboardRole = 'USER' | 'COORDINATOR' | 'ADMIN';

export type DenominatorSource = 'SNAPSHOT' | 'OPERATIONAL_CURRENT' | 'HISTORICAL_UNAVAILABLE';

export type DashboardAudienceCode = 'PILOTO' | 'TRIPULANTE' | 'HSAR' | 'TODOS' | string;

export type DashboardMember = {
  profileId: string;
  trigram: string;
  name: string;
  audiences: DashboardAudienceCode[];
  active: boolean;
  historicalProfileAvailable: boolean;
  limitationReason: string | null;
};

export type DashboardAvopRecord = {
  avopId: string;
  profileId: string;
  acknowledgedAt: string;
};

export type DashboardBriefingRecord = {
  briefingId: string;
  profileId: string;
  attendanceStatus: string;
  materialAcknowledged: boolean;
  recordedAt: string;
};

export type DashboardJustificationRecord = {
  briefingId: string;
  profileId: string;
  createdAt: string;
};

export type DashboardAvopSource = {
  id: string;
  number: string;
  title: string;
  publicationDate: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | string;
  requiresAcknowledgement: boolean;
  audiences: DashboardAudienceCode[];
  denominatorSource: DenominatorSource;
  members: DashboardMember[];
  acknowledgements: DashboardAvopRecord[];
};

export type DashboardBriefingSource = {
  id: string;
  legacyId: string;
  title: string;
  eventDate: string | null;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | string;
  effectiveStatus: 'OPEN' | 'CLOSED';
  requiresMaterialAcknowledgement: boolean;
  audiences: DashboardAudienceCode[];
  denominatorSource: DenominatorSource;
  members: DashboardMember[];
  records: DashboardBriefingRecord[];
  justifications: DashboardJustificationRecord[];
};

export type Percentage = {
  value: number;
  label: string;
};

export type DashboardAvopSummary = {
  id: string;
  number: string;
  title: string;
  publicationDate: string;
  status: string;
  denominatorSource: DenominatorSource;
  hasHistoricalLimitation: boolean;
  totalApplicable: number;
  acknowledged: number;
  pending: number;
  acknowledgementPercent: Percentage;
  pendingPercent: Percentage;
};

export type DashboardBriefingSummary = {
  id: string;
  legacyId: string;
  title: string;
  eventDate: string | null;
  status: string;
  effectiveStatus: 'OPEN' | 'CLOSED';
  denominatorSource: DenominatorSource;
  hasHistoricalLimitation: boolean;
  totalApplicable: number;
  present: number;
  absent: number;
  justified: number;
  pending: number;
  materialAcknowledged: number;
  presentPercent: Percentage;
  absentPercent: Percentage;
  justifiedPercent: Percentage;
  pendingPercent: Percentage;
  materialAcknowledgedPercent: Percentage;
};

export type AuditItemType = 'avop' | 'briefing';

export type AuditSituation =
  | 'CIENTE'
  | 'PENDENTE'
  | 'PRESENTE'
  | 'AUSENTE'
  | 'JUSTIFICADO'
  | 'SEM_CLASSIFICACAO';

export type AuditRow = {
  profileId: string;
  name: string;
  trigram: string;
  audiences: DashboardAudienceCode[];
  situation: AuditSituation;
  eventAt: string | null;
  materialAcknowledged?: boolean;
  materialAcknowledgedAt?: string | null;
  historicalProfileAvailable: boolean;
  limitationReason: string | null;
};

export type PaginatedAudit = {
  itemType: AuditItemType;
  itemId: string;
  itemLabel: string;
  denominatorSource: DenominatorSource;
  totalRows: number;
  page: number;
  pageSize: number;
  rows: AuditRow[];
};

export type ManagementDashboard = {
  avops: DashboardAvopSummary[];
  briefings: DashboardBriefingSummary[];
};

export type DashboardRepository = {
  loadDashboard(now?: Date): Promise<{
    avops: DashboardAvopSource[];
    briefings: DashboardBriefingSource[];
  }>;
};
