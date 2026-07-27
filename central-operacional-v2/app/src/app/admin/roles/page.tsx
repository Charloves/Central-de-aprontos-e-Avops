import Link from 'next/link';
import { INITIAL_ADMIN_ASSIGNMENT } from '@/lib/admin/roles';
import { requireAdminSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function AdminRolesPage() {
  const session = await requireAdminSession();

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Area administrativa</p>
            <h1>Transferencia de coordenacao</h1>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="button secondary" type="submit">Sair</button>
          </form>
        </div>

        <p>
          Sessao administrativa: <strong>{session.trigram}</strong>.
        </p>
        <p>
          Coordenador/admin inicial via seed: <strong>{INITIAL_ADMIN_ASSIGNMENT.trigram}</strong>.
          A alteracao definitiva sera registrada no banco com auditoria em etapa posterior.
        </p>

        <form className="grid">
          <label>
            <strong>Novo trigrama coordenador/admin</strong>
            <input className="input" name="toTrigram" placeholder="Ex.: ABC" />
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button className="button" type="button">Pre-visualizar transferencia</button>
          </div>
        </form>

        <p>
          <Link href="/portal">Voltar ao portal</Link>
        </p>
      </section>
    </main>
  );
}
