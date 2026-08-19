import { describe, expect, it, vi } from 'vitest';
import { SupabaseProfileRepository } from './supabase-profile-repository';

vi.mock('server-only', () => ({}));

describe('SupabaseProfileRepository', () => {
  it('qualifica o relacionamento de profile_roles pela FK do profile_id', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'profile-id',
        trigram: 'CHA',
        name: 'Usuario Ficticio',
        active: true,
        profile_roles: [{ role: 'ADMIN' }],
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    const repository = new SupabaseProfileRepository({ from } as never);
    const profile = await repository.findByTrigram('cha');

    expect(from).toHaveBeenCalledWith('profiles');
    expect(select).toHaveBeenCalledWith(
      'id,trigram,name,active,profile_roles!profile_roles_profile_id_fkey(role)',
    );
    expect(eq).toHaveBeenCalledWith('trigram', 'CHA');
    expect(profile?.roles).toEqual(expect.arrayContaining(['USER', 'ADMIN']));
  });

  it('carrega perfil por id para revalidar sessoes persistentes', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'profile-id',
        trigram: 'CHA',
        name: 'Usuario Ficticio',
        active: true,
        profile_roles: [{ role: 'COORDINATOR' }],
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    const repository = new SupabaseProfileRepository({ from } as never);
    const profile = await repository.findById('profile-id');

    expect(eq).toHaveBeenCalledWith('id', 'profile-id');
    expect(profile?.roles).toEqual(expect.arrayContaining(['USER', 'COORDINATOR']));
  });
});
