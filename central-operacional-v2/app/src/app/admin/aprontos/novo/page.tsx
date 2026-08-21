import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { requireAdminSession } from '@/lib/auth/server';
import { SupabasePublicationRepository } from '@/lib/admin/supabase-publication-repository';
import type { AdminAudience } from '@/lib/admin/publications';

export const dynamic = 'force-dynamic';

type NewBriefingPageProps = {
  searchParams?: Promise<{ id?: string | string[]; error?: string | string[]; saved?: string | string[] }>;
};

export default async function NewBriefingPage({ searchParams }: NewBriefingPageProps) {
  noStore();
  const session = await requireAdminSession();
  const params = searchParams ? await searchParams : {};
  const id = firstParam(params.id);
  const error = firstParam(params.error);
  const saved = firstParam(params.saved);
  const repository = new SupabasePublicationRepository();
  const [audiences, briefing] = await Promise.all([
    repository.listAudiences(),
    id ? repository.findBriefing(id) : Promise.resolve(null),
  ]);
  const isPublished = briefing?.status !== undefined && briefing.status !== 'DRAFT';

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Administração de aprontos</p>
            <h1>{briefing ? 'Editar apronto' : 'Novo apronto'}</h1>
            <p className="compact">Ator administrativo: <strong>{session.trigram}</strong>.</p>
          </div>
          <div className="actions">
            <Link className="button secondary" href="/admin/aprontos">Voltar</Link>
          </div>
        </div>

        {saved ? <p className="success">Rascunho salvo.</p> : null}
        {error ? <p className="alert" role="alert">Não foi possível salvar o rascunho.</p> : null}
        {isPublished ? <p className="alert">Registro publicado não pode ser alterado por esta tela.</p> : null}

        <form className="stack" action="/api/admin/aprontos/save" method="post">
          {briefing ? <input type="hidden" name="draftId" value={briefing.id} /> : null}
          <label>
            Identificador
            <input className="input" name="legacyId" defaultValue={briefing?.legacyId ?? ''} required maxLength={80} disabled={isPublished} />
          </label>
          <label>
            Título
            <input className="input" name="title" defaultValue={briefing?.title ?? ''} required maxLength={240} disabled={isPublished} />
          </label>
          <label>
            Data de realização
            <input className="input" name="eventDate" type="date" defaultValue={briefing?.eventDate ?? todayIsoDate()} required disabled={isPublished} />
          </label>
          <label>
            URL do material
            <input className="input" name="driveUrl" defaultValue={briefing?.driveUrl ?? ''} required maxLength={1000} disabled={isPublished} />
          </label>
          <label>
            Drive file ID
            <input className="input" name="driveFileId" defaultValue={briefing?.driveFileId ?? ''} maxLength={1000} disabled={isPublished} />
          </label>
          <label>
            <input name="requiresMaterialAcknowledgement" type="checkbox" defaultChecked={briefing?.requiresMaterialAcknowledgement ?? false} disabled={isPublished} /> Exige ciência de material
          </label>
          <AudienceCheckboxes audiences={audiences} selected={briefing?.audiences ?? []} disabled={isPublished} />
          <button className="button" type="submit" disabled={isPublished}>Salvar rascunho</button>
        </form>
      </section>
    </main>
  );
}

function AudienceCheckboxes({ audiences, selected, disabled }: { audiences: AdminAudience[]; selected: string[]; disabled: boolean }) {
  return (
    <fieldset className="card">
      <legend>Públicos aplicáveis</legend>
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
