import { describe, expect, it, vi } from 'vitest';
import { SupabaseProfileAdminRepository } from './supabase-profile-admin-repository';

vi.mock('server-only', () => ({}));

describe('SupabaseProfileAdminRepository', () => {
  it('qualifica FKs ambíguas ao listar perfis administrativos', async () => {
    const returns = vi.fn().mockReturnValue({
      data: [
        {
          id: 'profile-id',
          trigram: 'HML',
          name: 'Perfil Homologação',
          email: 'perfil@example.test',
          active: true,
          profile_roles: [{ role: 'USER' }],
          profile_audiences: [{ audiences: { code: 'TODOS', active: true } }],
        },
      ],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ returns });
    const select = vi.fn().mockReturnValue({ order });
    const from = vi.fn().mockReturnValue({ select });

    const repository = new SupabaseProfileAdminRepository({ from } as never);
    const profiles = await repository.listProfiles();

    expect(from).toHaveBeenCalledWith('profiles');
    expect(select).toHaveBeenCalledWith(
      'id,trigram,name,email,active,profile_roles!profile_roles_profile_id_fkey(role),profile_audiences!profile_audiences_profile_id_fkey(audiences!profile_audiences_audience_id_fkey(code,active))',
    );
    expect(order).toHaveBeenCalledWith('name', { ascending: true });
    expect(profiles).toEqual([
      {
        profileId: 'profile-id',
        trigram: 'HML',
        name: 'Perfil Homologação',
        email: 'perfil@example.test',
        active: true,
        roles: ['USER'],
        audiences: ['TODOS'],
      },
    ]);
  });
});
