import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { requireAdminSession } from '@/lib/auth/server';
import { SupabasePublicationRepository } from '@/lib/admin/supabase-publication-repository';
import type { AdminAudience } from '@/lib/admin/publications';

export const dynamic = 'force-dynamic';

type NewAvopPageProps = {
  searchParams?: Promise<{ id?: string | string[]; error?: string | string[]; saved?: string | string[] }>;
};

export default async function NewAvopPage({ searchParams }: NewAvopPageProps) {
  noStore();
  const session = await requireAdminSession();
  const params = searchParams ? await searchParams : {};
  const id = firstParam(params.id);
  const error = firstParam(params.error);
  const saved = firstParam(params.saved);
  const repository = new SupabasePublicationRepository();
  const [audiences, avop] = await Promise.all([
    repository.listAudiences(),
    id ? repository.findAvop(id) : Promise.resolve(null),
  ]);
  const isPublished = avop?.status !== undefined && avop.status !== 'DRAFT';

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Administracao de AVOPs</p>
            <h1>{avop ? 'Editar AVOP' : 'Novo AVOP'}</h1>
            <p className="compact">Ator administrativo: <strong>{session.trigram}</strong>.</p>
          </div>
          <div className="actions">
            <Link className="button secondary" href="/admin/avops">Voltar</Link>
          </div>
        </div>

        {saved ? <p className="success">Rascunho salvo.</p> : null}
        {error ? <p className="alert" role="alert">Nao foi possivel salvar o rascunho.</p> : null}
        {isPublished ? <p className="alert">Registro publicado nao pode ser alterado por esta tela.</p> : null}

        <form className="stack" action="/api/admin/avops/save" method="post">
          {avop ? <input type="hidden" name="draftId" value={avop.id} /> : null}
          <label>
            Identificador
            <input className="input" name="number" defaultValue={avop?.number ?? ''} required maxLength={80} disabled={isPublished} />
          </label>
          <label>
            Titulo
            <input className="input" name="title" defaultValue={avop?.title ?? ''} required maxLength={240} disabled={isPublished} />
          </label>
          <label>
            Data de publicacao
            <input className="input" name="publicationDate" type="date" defaultValue={avop?.publicationDate ?? todayIsoDate()} required disabled={isPublished} />
          </label>
          <label>
            URL do documento
            <input className="input" name="driveUrl" defaultValue={avop?.driveUrl ?? ''} required maxLength={1000} disabled={isPublished} />
          </label>
          <label>
            Drive file ID
            <input className="input" name="driveFileId" defaultValue={avop?.driveFileId ?? ''} maxLength={1000} disabled={isPublished} />
          </label>
          <label>
            <input name="requiresAcknowledgement" type="checkbox" defaultChecked={avop?.requiresAcknowledgement ?? true} disabled={isPublished} /> Exige ciencia
          </label>
          <AudienceCheckboxes audiences={audiences} selected={avop?.audiences ?? []} disabled={isPublished} />
          <button className="button" type="submit" disabled={isPublished}>Salvar rascunho</button>
        </form>
      </section>
    </main>
  );
}

function AudienceCheckboxes({ audiences, selected, disabled }: { audiences: AdminAudience[]; selected: string[]; disabled: boolean }) {
  return (
    <fieldset className="card">
      <legend>Publicos aplicaveis</legend>
      <div className="actions">
        {audiences.map((audience) => (
          <label key={audience.id}>
            <input name="audiences" type="checkbox" value={audience.code} defaultChecked={selected.includes(audience.code)} disabled={disabled} /> {audience.code}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
