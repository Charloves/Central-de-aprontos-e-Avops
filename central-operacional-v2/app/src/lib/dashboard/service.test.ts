import { describe, expect, it } from 'vitest';
import { FakeDashboardRepository } from './fake-dashboard-repository';
import {
  buildAvopAuditRows,
  buildBriefingAuditRows,
  buildManagementDashboard,
  loadNominalAudit,
  percentage,
} from './rules';
import type { DashboardAvopSource, DashboardBriefingSource, DashboardMember } from './types';

const pilot: DashboardMember = {
  profileId: 'profile-pilot',
  trigram: 'PLT',
  name: 'Piloto Ficticio',
  audiences: ['PILOTO'],
  active: true,
  historicalProfileAvailable: true,
  limitationReason: null,
};

const mixed: DashboardMember = {
  profileId: 'profile-mixed',
  trigram: 'MIX',
  name: 'Perfil Misto',
  audiences: ['PILOTO', 'TRIPULANTE'],
  active: true,
  historicalProfileAvailable: true,
  limitationReason: null,
};

const unavailable: DashboardMember = {
  profileId: 'profile-limited',
  trigram: 'LIM',
  name: 'Perfil Limitado',
  audiences: ['HSAR'],
  active: false,
  historicalProfileAvailable: false,
  limitationReason: 'perfil historico nao disponivel',
};

describe('dashboard gerencial', () => {
  it('deduplica perfil em publicos mistos e reconcilia ciencia de AVOP', () => {
    const avop: DashboardAvopSource = {
      id: 'avop-1',
      number: 'AVOP 01',
      title: 'Aviso',
      publicationDate: '2026-08-01',
      status: 'PUBLISHED',
      requiresAcknowledgement: true,
      audiences: ['PILOTO', 'TRIPULANTE'],
      denominatorSource: 'SNAPSHOT',
      members: [pilot, { ...mixed, audiences: ['PILOTO'] }, { ...mixed, audiences: ['TRIPULANTE'] }],
      acknowledgements: [
        { avopId: 'avop-1', profileId: 'profile-pilot', acknowledgedAt: '2026-08-02T10:00:00Z' },
        { avopId: 'avop-1', profileId: 'profile-pilot', acknowledgedAt: '2026-08-03T10:00:00Z' },
      ],
    };

    const dashboard = buildManagementDashboard({ avops: [avop], briefings: [] });

    expect(dashboard.avops[0]).toMatchObject({
      totalApplicable: 2,
      acknowledged: 1,
      pending: 1,
      denominatorSource: 'SNAPSHOT',
    });
    expect(dashboard.avops[0].acknowledgementPercent.label).toBe('50,0%');
    expect(buildAvopAuditRows(avop).map((row) => row.situation)).toEqual(['PENDENTE', 'CIENTE']);
  });

  it('rotula limitacao historica quando snapshot nao comprova perfil', () => {
    const avop: DashboardAvopSource = {
      id: 'avop-2',
      number: 'AVOP 02',
      title: 'Aviso limitado',
      publicationDate: '2026-08-01',
      status: 'PUBLISHED',
      requiresAcknowledgement: true,
      audiences: ['HSAR'],
      denominatorSource: 'SNAPSHOT',
      members: [unavailable],
      acknowledgements: [],
    };

    const summary = buildManagementDashboard({ avops: [avop], briefings: [] }).avops[0];

    expect(summary.denominatorSource).toBe('HISTORICAL_UNAVAILABLE');
    expect(summary.hasHistoricalLimitation).toBe(true);
  });

  it('calcula apronto sem transformar justificativa ou ciencia de material em presenca', () => {
    const briefing: DashboardBriefingSource = {
      id: 'briefing-1',
      legacyId: 'APR 01',
      title: 'Apronto',
      eventDate: '2026-08-10',
      status: 'OPEN',
      effectiveStatus: 'OPEN',
      requiresMaterialAcknowledgement: true,
      audiences: ['TODOS'],
      denominatorSource: 'OPERATIONAL_CURRENT',
      members: [pilot, mixed, unavailable],
      records: [
        {
          briefingId: 'briefing-1',
          profileId: 'profile-pilot',
          attendanceStatus: 'PRESENTE',
          materialAcknowledged: false,
          recordedAt: '2026-08-10T10:00:00Z',
        },
        {
          briefingId: 'briefing-1',
          profileId: 'profile-mixed',
          attendanceStatus: 'PENDENTE',
          materialAcknowledged: true,
          recordedAt: '2026-08-10T11:00:00Z',
        },
      ],
      justifications: [
        { briefingId: 'briefing-1', profileId: 'profile-mixed', createdAt: '2026-08-10T12:00:00Z' },
        { briefingId: 'briefing-1', profileId: 'profile-mixed', createdAt: '2026-08-10T13:00:00Z' },
      ],
    };

    const summary = buildManagementDashboard({ avops: [], briefings: [briefing] }).briefings[0];

    expect(summary).toMatchObject({
      totalApplicable: 3,
      present: 1,
      justified: 1,
      pending: 1,
      materialAcknowledged: 1,
    });
    expect(buildBriefingAuditRows(briefing).map((row) => row.situation)).toEqual([
      'PENDENTE',
      'JUSTIFICADO',
      'PRESENTE',
    ]);
  });

  it('retorna percentuais seguros quando denominador e zero', () => {
    expect(percentage(1, 0)).toEqual({ value: 0, label: '0,0%' });
  });

  it('pagina auditoria nominal sem enviar a base inteira', async () => {
    const avop: DashboardAvopSource = {
      id: 'avop-3',
      number: 'AVOP 03',
      title: 'Auditoria',
      publicationDate: '2026-08-01',
      status: 'PUBLISHED',
      requiresAcknowledgement: true,
      audiences: ['PILOTO'],
      denominatorSource: 'OPERATIONAL_CURRENT',
      members: [pilot, mixed],
      acknowledgements: [],
    };
    const audit = await loadNominalAudit({
      repository: new FakeDashboardRepository({ avops: [avop], briefings: [] }),
      itemType: 'avop',
      itemId: 'avop-3',
      page: 1,
      pageSize: 1,
    });

    expect(audit?.totalRows).toBe(2);
    expect(audit?.rows).toHaveLength(1);
    expect(audit?.rows[0]).not.toHaveProperty('email');
  });
});
