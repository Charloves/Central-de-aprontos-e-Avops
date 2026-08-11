import Link from 'next/link';
import { hasAdminAccess } from '@/lib/auth/session';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

type PortalPageProps = {
  searchParams?: Promise<{ error?: string | string[] }>;
};

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const session = await requireSession();
  const params = searchParams ? await searchParams : {};
  const error = Array.isArray(params.error) ? params.error[0] : params.error;

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Sessao V2 de homologacao</p>
            <h1>Usuario {session.trigram}</h1>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="button secondary" type="submit">Sair</button>
          </form>
        </div>

        {error === 'forbidden' ? (
          <p className="alert" role="alert">
            A area administrativa exige perfil de coordenador ou administrador.
          </p>
        ) : null}

        <p>
          Esta tela ja usa sessao assinada em cookie HttpOnly. Os modulos reais serao conectados nas proximas etapas.
        </p>

        <div className="grid">
          <article className="card">
            <h2>AVOP</h2>
            <p>Listagem aplicavel ao perfil e registro de ciencia idempotente.</p>
            <Link href="/portal/avops">Abrir AVOPs</Link>
          </article>
          <article className="card">
            <h2>Aprontos</h2>
            <p>Consulta de aprontos, justificativa e ciencia de material.</p>
            <Link href="/portal/aprontos">Abrir aprontos</Link>
          </article>
          <article className="card">
            <h2>OI</h2>
            <p>Pesquisa por H50/H125, missao completa e fase.</p>
            <Link href="/portal/oi">Abrir OI</Link>
          </article>
          {hasAdminAccess(session) ? (
            <article className="card">
              <h2>Administracao</h2>
              <p>Area restrita a COORDINATOR e ADMIN.</p>
              <div className="actions">
                <Link href="/admin/dashboard">Dashboard</Link>
                <Link href="/admin/auditoria">Auditoria nominal</Link>
                <Link href="/admin/roles">Transferencia</Link>
              </div>
            </article>
          ) : null}
        </div>
      </section>
    </main>
  );
}
