import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { requireAdminSession } from '@/lib/auth/server';
import { SupabasePublicationRepository } from '@/lib/admin/supabase-publication-repository';
import type { AdminAvopDraft } from '@/lib/admin/publications';

export const dynamic = 'force-dynamic';

type AdminAvopsPageProps = {
  searchParams?: Promise<{ error?: string | string[]; published?: string | string[] }>;
};

export default async function AdminAvopsPage({ searchParams }: AdminAvopsPageProps) {
  noStore();
  const session = await requireAdminSession();
  const params = searchParams ? await searchParams : {};
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const published = Array.isArray(params.published) ? params.published[0] : params.published;
  const avops = await new SupabasePublicationRepository().listAvops();

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Administração de AVOPs</p>
            <h1>Publicação com snapshot nominal</h1>
            <p className="compact">Sessão administrativa: <strong>{session.trigram}</strong>.</p>
          </div>
          <div className="actions">
            <Link className="button" href="/admin/avops/novo">Novo AVOP</Link>
            <Link className="button secondary" href="/portal">Portal</Link>
          </div>
        </div>

        {published ? <p className="success">AVOP publicado com snapshot nominal preservado.</p> : null}
        {error ? <p className="alert" role="alert">Não foi possível publicar o AVOP.</p> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>AVOP</th>
                <th>Publicação</th>
                <th>Públicos</th>
                <th>Status</th>
                <th>Snapshot</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {avops.map((avop) => (
                <tr key={avop.id}>
                  <td>
                    <strong>{avop.number}</strong>
                    <p className="compact">{avop.title}</p>
                  </td>
                  <td>{formatDate(avop.publicationDate)}</td>
                  <td>{avop.audiences.join(', ') || 'Sem público'}</td>
                  <td>{statusLabel(avop.status)}</td>
                  <td>{snapshotLabel(avop.snapshot)}</td>
                  <td>
                    <div className="actions">
                      <Link href={`/admin/avops/novo?id=${encodeURIComponent(avop.id)}`}>{avop.status === 'DRAFT' ? 'Editar' : 'Ver'}</Link>
                      {avop.status === 'DRAFT' ? <PublishAvopForm avop={avop} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function PublishAvopForm({ avop }: { avop: AdminAvopDraft }) {
  return (
    <form action="/api/admin/avops/publish" method="post">
      <input type="hidden" name="id" value={avop.id} />
      <button className="button" type="submit">Publicar</button>
    </form>
  );
}

function statusLabel(status: AdminAvopDraft['status']): string {
  if (status === 'PUBLISHED') return 'Publicado';
  if (status === 'CLOSED') return 'Fechado';
  return 'Rascunho';
}

function snapshotLabel(snapshot: AdminAvopDraft['snapshot']): string {
  if (!snapshot) return 'Ainda não publicado';
  return `${snapshot.applicableProfileCount} aplicáveis`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}
