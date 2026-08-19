import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { requireAdminSession } from '@/lib/auth/server';
import { SupabasePublicationRepository } from '@/lib/admin/supabase-publication-repository';
import type { AdminBriefingDraft } from '@/lib/admin/publications';

export const dynamic = 'force-dynamic';

type AdminBriefingsPageProps = {
  searchParams?: Promise<{ error?: string | string[]; published?: string | string[] }>;
};

export default async function AdminBriefingsPage({ searchParams }: AdminBriefingsPageProps) {
  noStore();
  const session = await requireAdminSession();
  const params = searchParams ? await searchParams : {};
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const published = Array.isArray(params.published) ? params.published[0] : params.published;
  const briefings = await new SupabasePublicationRepository().listBriefings();

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Administração de aprontos</p>
            <h1>Publicação com snapshot nominal</h1>
            <p className="compact">Sessão administrativa: <strong>{session.trigram}</strong>.</p>
          </div>
          <div className="actions">
            <Link className="button" href="/admin/aprontos/novo">Novo apronto</Link>
            <Link className="button secondary" href="/portal">Portal</Link>
          </div>
        </div>

        {published ? <p className="success">Apronto publicado com snapshot nominal preservado.</p> : null}
        {error ? <p className="alert" role="alert">Não foi possível publicar o apronto.</p> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Apronto</th>
                <th>Data</th>
                <th>Públicos</th>
                <th>Status</th>
                <th>Snapshot</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {briefings.map((briefing) => (
                <tr key={briefing.id}>
                  <td>
                    <strong>{briefing.legacyId}</strong>
                    <p className="compact">{briefing.title}</p>
                  </td>
                  <td>{formatDate(briefing.eventDate)}</td>
                  <td>{briefing.audiences.join(', ') || 'Sem público'}</td>
                  <td>{statusLabel(briefing.status)}</td>
                  <td>{snapshotLabel(briefing.snapshot)}</td>
                  <td>
                    <div className="actions">
                      <Link href={`/admin/aprontos/novo?id=${encodeURIComponent(briefing.id)}`}>{briefing.status === 'DRAFT' ? 'Editar' : 'Ver'}</Link>
                      {briefing.status === 'DRAFT' ? <PublishBriefingForm briefing={briefing} /> : null}
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

function PublishBriefingForm({ briefing }: { briefing: AdminBriefingDraft }) {
  return (
    <form action="/api/admin/aprontos/publish" method="post">
      <input type="hidden" name="id" value={briefing.id} />
      <button className="button" type="submit">Publicar</button>
    </form>
  );
}

function statusLabel(status: AdminBriefingDraft['status']): string {
  if (status === 'OPEN') return 'Aberto';
  if (status === 'CLOSED') return 'Fechado';
  return 'Rascunho';
}

function snapshotLabel(snapshot: AdminBriefingDraft['snapshot']): string {
  if (!snapshot) return 'Ainda não publicado';
  return `${snapshot.applicableProfileCount} aplicáveis`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}
