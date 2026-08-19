import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import type { OiRecord } from '@/lib/domain/types';
import { normalizeOiAircraft } from './rules';
import type { OiRepository } from './types';

type OiRow = {
  aircraft: string;
  oi_key: string;
  program: string;
  subprogram: string;
  phase_id: string;
  title: string;
  drive_url: string;
  drive_file_id: string | null;
  start_page: number;
  end_page: number | null;
  display_key: string;
  mission_codes: string[] | null;
  active: boolean;
};

export class SupabaseOiRepository implements OiRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async listActiveOis(): Promise<OiRecord[]> {
    const { data, error } = await this.client
      .from('ois')
      .select('aircraft,oi_key,program,subprogram,phase_id,title,drive_url,drive_file_id,start_page,end_page,display_key,mission_codes,active')
      .eq('active', true)
      .order('aircraft', { ascending: true })
      .order('oi_key', { ascending: true })
      .returns<OiRow[]>();
    if (error) throw error;
    return (data ?? []).map(mapOiRow).filter((record): record is OiRecord => record !== null);
  }
}

function mapOiRow(row: OiRow): OiRecord | null {
  const aircraft = normalizeOiAircraft(row.aircraft);
  if (!aircraft) return null;
  return {
    aircraft,
    oiKey: row.oi_key,
    program: row.program,
    subprogram: row.subprogram,
    phaseId: row.phase_id,
    title: row.title,
    driveUrl: row.drive_url,
    driveFileId: row.drive_file_id,
    startPage: row.start_page,
    endPage: row.end_page,
    displayKey: row.display_key,
    missionCodes: row.mission_codes ?? [],
    active: row.active,
  };
}
