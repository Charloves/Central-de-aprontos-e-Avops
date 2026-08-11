import { describe, expect, it, vi } from 'vitest';
import { SupabaseOiRepository } from './supabase-oi-repository';

vi.mock('server-only', () => ({}));

describe('SupabaseOiRepository', () => {
  it('consulta somente OIs ativas e normaliza H-50/H-125 para o dominio', async () => {
    const returns = vi.fn().mockResolvedValue({
      data: [
        {
          aircraft: 'H-50',
          oi_key: 'OI-H50',
          program: 'PESOP',
          subprogram: 'SPFO',
          phase_id: '01HE01',
          title: 'OI H50',
          drive_url: 'https://drive.google.com/file/d/h50/view',
          drive_file_id: 'h50',
          start_page: 1,
          end_page: 3,
          display_key: '01HE01 - OI H50',
          mission_codes: ['01HE01D01'],
          active: true,
        },
        {
          aircraft: 'H-125',
          oi_key: 'OI-H125',
          program: 'PESOP',
          subprogram: 'SPHA',
          phase_id: '02HE02',
          title: 'OI H125',
          drive_url: 'https://drive.google.com/file/d/h125/view',
          drive_file_id: 'h125',
          start_page: 4,
          end_page: null,
          display_key: '02HE02 - OI H125',
          mission_codes: null,
          active: true,
        },
        {
          aircraft: 'H-60',
          oi_key: 'OI-UNKNOWN',
          program: 'PESOP',
          subprogram: 'SPXX',
          phase_id: '03HE03',
          title: 'OI desconhecida',
          drive_url: 'https://drive.google.com/file/d/unknown/view',
          drive_file_id: 'unknown',
          start_page: 5,
          end_page: 6,
          display_key: '03HE03 - OI desconhecida',
          mission_codes: [],
          active: true,
        },
      ],
      error: null,
    });
    const orderOiKey = vi.fn(() => ({ returns }));
    const orderAircraft = vi.fn(() => ({ order: orderOiKey }));
    const eq = vi.fn(() => ({ order: orderAircraft }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const repository = new SupabaseOiRepository({ from } as never);
    const result = await repository.listActiveOis();

    expect(from).toHaveBeenCalledWith('ois');
    expect(select).toHaveBeenCalledWith('aircraft,oi_key,program,subprogram,phase_id,title,drive_url,drive_file_id,start_page,end_page,display_key,mission_codes,active');
    expect(eq).toHaveBeenCalledWith('active', true);
    expect(result.map((item) => item.aircraft)).toEqual(['H50', 'H125']);
    expect(result[1]?.missionCodes).toEqual([]);
  });

  it('retorna erro generico ao servico quando Supabase falha', async () => {
    const returns = vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
    const orderOiKey = vi.fn(() => ({ returns }));
    const orderAircraft = vi.fn(() => ({ order: orderOiKey }));
    const eq = vi.fn(() => ({ order: orderAircraft }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const repository = new SupabaseOiRepository({ from } as never);

    await expect(repository.listActiveOis()).rejects.toEqual({ message: 'database unavailable' });
  });
});
