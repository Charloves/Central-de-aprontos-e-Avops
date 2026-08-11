import type {
  DashboardAvopSource,
  DashboardBriefingSource,
  DashboardRepository,
} from './types';

export class FakeDashboardRepository implements DashboardRepository {
  constructor(
    private readonly data: {
      avops: DashboardAvopSource[];
      briefings: DashboardBriefingSource[];
    },
  ) {}

  async loadDashboard(): Promise<{
    avops: DashboardAvopSource[];
    briefings: DashboardBriefingSource[];
  }> {
    return this.data;
  }
}
