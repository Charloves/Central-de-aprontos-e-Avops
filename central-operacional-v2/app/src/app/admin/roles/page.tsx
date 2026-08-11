import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { requireAdminSession } from '@/lib/auth/server';
import { ROLE_TRANSFER_CONFIRMATION } from '@/lib/admin/roles';
import { SupabaseManagementRoleRepository } from '@/lib/admin/supabase-roles-repository';

export const dynamic = 'force-dynamic';

type AdminRolesPageProps = {
  searchParams?: Promise<{
    error?: string | string[];
  }>;
};

export default async function AdminRolesPage({ searchParams }: AdminRolesPageProps) {
  noStore();
  const session = await requireAdminSession();
  const params = searchParams ? await searchParams : {};
  const hasError = firstParam(params.error) === 'transfer';
  const holders = await new SupabaseManagementRoleRepository().listManagementRoleHolders();

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Área administrativa</p>
            <h1>Transferência de coordenação</h1>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="button secondary" type="submit">Sair</button>
          </form>
        </div>

        <p>
          Sessão administrativa: <strong>{session.trigram}</strong>.
        </p>

        {hasError ? (
          <p className="alert" role="alert">
            Não foi possível concluir a transferência. Verifique os dados e tente novamente.
          </p>
        ) : null}

        <section className="stack" aria-labelledby="current-admins">
          <div>
            <p className="muted">Gestão atual</p>
            <h2 id="current-admins">ADMIN e COORDINATOR ativos</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Trigrama</th>
                  <th>Papéis</th>
                </tr>
              </thead>
              <tbody>
                {holders.map((holder) => (
                  <tr key={holder.profileId}>
                    <td>{holder.name}</td>
                    <td>{holder.trigram}</td>
                    <td>{holder.roles.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="stack" aria-labelledby="transfer-heading">
          <div>
            <p className="muted">Transferência atômica</p>
            <h2 id="transfer-heading">Novo coordenador/admin</h2>
            <p className="compact">
              ADMIN e COORDINATOR serão transferidos juntos. O executor perderá acesso administrativo imediatamente,
              mas continuará com USER. A operação será registrada em auditoria.
            </p>
          </div>

          <form className="grid" action="/api/admin/roles/transfer" method="post">
            <label>
              <strong>Trigrama do destino</strong>
              <input className="input" name="targetTrigram" placeholder="Ex.: USR" maxLength={10} autoComplete="off" required />
            </label>
            <label>
              <strong>Repita o trigrama</strong>
              <input className="input" name="targetTrigramRepeat" placeholder="Repita o trigrama" maxLength={10} autoComplete="off" required />
            </label>
            <label>
              <strong>Confirmação textual</strong>
              <input
                className="input"
                name="confirmation"
                placeholder={ROLE_TRANSFER_CONFIRMATION}
                autoComplete="off"
                required
              />
            </label>
            <div style={{ alignSelf: 'end' }}>
              <button className="button" type="submit">Transferir ADMIN e COORDINATOR</button>
            </div>
          </form>
        </section>

        <p>
          <Link href="/portal">Voltar ao portal</Link>
        </p>
        <p>
          <Link href="/admin/dashboard">Abrir dashboard gerencial</Link>
        </p>
      </section>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
