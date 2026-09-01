import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminSession } from '@/lib/auth/server';
import { SupabaseProfileAdminRepository } from '@/lib/admin/supabase-profile-admin-repository';
import type { AdminProfileSummary } from '@/lib/admin/profiles';
import type { Role } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

type AdminProfileFormPageProps = {
  searchParams?: Promise<{
    id?: string | string[];
  }>;
};

export default async function AdminProfileFormPage({ searchParams }: AdminProfileFormPageProps) {
  noStore();
  const session = await requireAdminSession();
  if (!session.roles.includes('ADMIN')) redirect('/admin/perfis?error=save');

  const params = searchParams ? await searchParams : {};
  const targetId = firstParam(params.id);
  const repository = new SupabaseProfileAdminRepository();
  const [profiles, audienceCodes] = await Promise.all([
    repository.listProfiles(),
    repository.listAudienceCodes(),
  ]);
  const profile = targetId ? profiles.find((item) => item.profileId === targetId) ?? null : null;
  if (targetId && !profile) redirect('/admin/perfis?error=save');

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Gestão de perfis</p>
            <h1>{profile ? 'Editar perfil' : 'Criar perfil'}</h1>
          </div>
          <Link href="/admin/perfis">Voltar</Link>
        </div>

        <form className="grid" action="/api/admin/profiles/save" method="post">
          {profile ? <input type="hidden" name="targetProfileId" value={profile.profileId} /> : null}

          <label>
            <strong>Trigrama</strong>
            <input className="input" name="trigram" defaultValue={profile?.trigram ?? ''} maxLength={10} autoComplete="off" required />
          </label>

          <label>
            <strong>Nome</strong>
            <input className="input" name="name" defaultValue={profile?.name ?? ''} maxLength={120} autoComplete="off" required />
          </label>

          <label>
            <strong>E-mail</strong>
            <input className="input" name="email" defaultValue={profile?.email ?? ''} type="email" autoComplete="off" />
          </label>

          <label className="checkbox-line">
            <input type="checkbox" name="active" defaultChecked={profile?.active ?? true} />
            Perfil ativo
          </label>

          <fieldset className="stack">
            <legend><strong>Públicos</strong></legend>
            {audienceCodes.map((code) => (
              <label key={code} className="checkbox-line">
                <input
                  type="checkbox"
                  name="audienceCodes"
                  value={code}
                  defaultChecked={profile?.audiences.includes(code) ?? false}
                />
                {code}
              </label>
            ))}
          </fieldset>

          <fieldset className="stack">
            <legend><strong>Papéis permitidos</strong></legend>
            {(['USER', 'COORDINATOR'] satisfies Role[]).map((role) => (
              <label key={role} className="checkbox-line">
                <input
                  type="checkbox"
                  name="roles"
                  value={role}
                  defaultChecked={profileHasRole(profile, role)}
                />
                {role}
              </label>
            ))}
            {profile?.roles.includes('ADMIN') ? (
              <p className="muted">
                Este perfil possui ADMIN. Esse papel não pode ser removido ou concedido nesta tela; use a transferência
                administrativa.
              </p>
            ) : null}
          </fieldset>

          <div>
            <button className="button" type="submit">Salvar perfil</button>
          </div>
        </form>
      </section>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function profileHasRole(profile: AdminProfileSummary | null, role: Extract<Role, 'USER' | 'COORDINATOR'>) {
  if (!profile) return role === 'USER';
  return profile.roles.includes(role);
}
