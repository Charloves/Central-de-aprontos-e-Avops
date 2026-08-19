import type { OiRecord } from '@/lib/domain/types';
import type { OiRepository } from './types';

export class FakeOiRepository implements OiRepository {
  public listCalls = 0;
  public writeCalls = 0;

  constructor(
    private readonly records: OiRecord[],
    private readonly options: { fail?: boolean } = {},
  ) {}

  async listActiveOis(): Promise<OiRecord[]> {
    this.listCalls += 1;
    if (this.options.fail) throw new Error('Supabase unavailable');
    return this.records.filter((record) => record.active);
  }
}
