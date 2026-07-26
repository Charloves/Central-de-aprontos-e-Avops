import { INITIAL_ADMIN_ASSIGNMENT } from '@/lib/admin/roles';

export default function AdminRolesPage() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="muted">Área administrativa</p>
        <h1>Transferência de coordenação</h1>
        <p>
          Coordenador/admin inicial: <strong>{INITIAL_ADMIN_ASSIGNMENT.trigram}</strong>.
          A alteração definitiva será registrada no banco com auditoria.
        </p>
        <form className="grid">
          <label>
            <strong>Novo trigrama coordenador/admin</strong>
            <input className="input" name="toTrigram" placeholder="Ex.: ABC" />
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button className="button" type="button">Pré-visualizar transferência</button>
          </div>
        </form>
      </section>
    </main>
  );
}
