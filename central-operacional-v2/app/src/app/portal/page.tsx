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
            <p className="muted">Sessão V2 de homologação</p>
            <h1>Usuário {session.trigram}</h1>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="button secondary" type="submit">Sair</button>
          </form>
        </div>

        {error === 'forbidden' ? (
          <p className="alert" role="alert">
            A área administrativa exige perfil de coordenador ou administrador.
          </p>
        ) : null}

        <p>
          Esta tela já usa sessão assinada em cookie HttpOnly. Os módulos reais serão conectados nas próximas etapas.
        </p>

        <div className="grid">
          <article className="card">
            <h2>AVOP</h2>
            <p>Listagem aplicável ao perfil e registro de ciência idempotente.</p>
            <Link href="/portal/avops">Abrir AVOPs</Link>
          </article>
          <article className="card">
            <h2>Aprontos</h2>
            <p>Consulta de aprontos, justificativa e ciência de material.</p>
            <Link href="/portal/aprontos">Abrir aprontos</Link>
          </article>
          <article className="card">
            <h2>OI</h2>
            <p>Pesquisa por H50/H125, missão completa e fase.</p>
            <Link href="/portal/oi">Abrir OI</Link>
          </article>
          {hasAdminAccess(session) ? (
            <article className="card">
              <h2>Administração</h2>
              <p>Área restrita a COORDINATOR e ADMIN.</p>
              <div className="actions">
                <Link href="/admin/dashboard">Dashboard</Link>
                <Link href="/admin/auditoria">Auditoria nominal</Link>
                <Link href="/admin/perfis">Gerenciar perfis</Link>
                <Link href="/admin/avops">Gerenciar AVOPs</Link>
                <Link href="/admin/aprontos">Gerenciar aprontos</Link>
                <Link href="/admin/importacao">Importar dados legados</Link>
                <Link href="/admin/roles">Transferência</Link>
              </div>
            </article>
          ) : null}
        </div>
      </section>
    </main>
  );
}
