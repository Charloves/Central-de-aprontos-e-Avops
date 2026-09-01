import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { requireAdminSession } from '@/lib/auth/server';
import { SupabaseProfileAdminRepository } from '@/lib/admin/supabase-profile-admin-repository';

export const dynamic = 'force-dynamic';

type AdminProfilesPageProps = {
  searchParams?: Promise<{
    error?: string | string[];
    saved?: string | string[];
  }>;
};

export default async function AdminProfilesPage({ searchParams }: AdminProfilesPageProps) {
  noStore();
  const session = await requireAdminSession();
  const params = searchParams ? await searchParams : {};
  const repository = new SupabaseProfileAdminRepository();
  const profiles = await repository.listProfiles();
  const canMutate = session.roles.includes('ADMIN');

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Área administrativa</p>
            <h1>Gestão de perfis</h1>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="button secondary" type="submit">Sair</button>
          </form>
        </div>

        {firstParam(params.error) === 'save' ? (
          <p className="alert" role="alert">
            Não foi possível salvar o perfil. Verifique os dados e tente novamente.
          </p>
        ) : null}

        {firstParam(params.saved) ? (
          <p className="success" role="status">Perfil salvo com auditoria registrada.</p>
        ) : null}

        <p className="compact">
          Perfis, públicos e papéis são alterados exclusivamente por ADMIN. A concessão de ADMIN permanece restrita ao
          fluxo de transferência administrativa.
        </p>

        {canMutate ? (
          <p>
            <Link className="button" href="/admin/perfis/novo">Criar perfil</Link>
          </p>
        ) : (
          <p className="muted">Seu papel permite consulta administrativa, mas não alteração de perfis.</p>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Trigrama</th>
                <th>E-mail</th>
                <th>Situação</th>
                <th>Públicos</th>
                <th>Papéis</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.profileId}>
                  <td>{profile.name}</td>
                  <td>{profile.trigram}</td>
                  <td>{profile.email ?? 'Não informado'}</td>
                  <td>{profile.active ? 'Ativo' : 'Inativo'}</td>
                  <td>{profile.audiences.join(', ') || 'Sem público'}</td>
                  <td>{profile.roles.join(', ')}</td>
                  <td>
                    {canMutate ? (
                      <Link href={`/admin/perfis/novo?id=${encodeURIComponent(profile.profileId)}`}>Editar</Link>
                    ) : (
                      <span className="muted">Somente leitura</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>
          <Link href="/admin/roles">Transferência de coordenação</Link>
        </p>
        <p>
          <Link href="/portal">Voltar ao portal</Link>
        </p>
      </section>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
