import { normalizeTrigram } from '@/lib/domain/normalization';

type PortalPageProps = {
  searchParams?: Promise<{ trigram?: string | string[] }>;
};

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const rawTrigram = Array.isArray(resolvedSearchParams.trigram)
    ? resolvedSearchParams.trigram[0]
    : resolvedSearchParams.trigram;
  const trigram = normalizeTrigram(rawTrigram);
  const isInitialAdmin = trigram === 'CHA';

  return (
    <main className="shell">
      <section className="panel">
        <p className="muted">Sessão V2 de homologação</p>
        <h1>{trigram ? `Usuário ${trigram}` : 'Trigrama não informado'}</h1>
        <p>
          Esta tela ainda usa dados demonstrativos. A próxima etapa é conectar a autenticação ao banco de homologação
          importado da planilha.
        </p>

        <div className="grid">
          <article className="card">
            <h2>AVOP</h2>
            <p>Listagem aplicável ao perfil e registro de ciência idempotente.</p>
          </article>
          <article className="card">
            <h2>Aprontos</h2>
            <p>Registro de presença, justificativa e ciência de material.</p>
          </article>
          <article className="card">
            <h2>OI</h2>
            <p>Pesquisa por H50/H125, missão completa e fase.</p>
          </article>
          {isInitialAdmin ? (
            <article className="card">
              <h2>Administração</h2>
              <p>CHA está configurado como coordenador/admin inicial para a V2.</p>
            </article>
          ) : null}
        </div>
      </section>
    </main>
  );
}
