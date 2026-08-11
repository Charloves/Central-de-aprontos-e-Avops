import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { requireAdminSession } from '@/lib/auth/server';
import { denominatorLabel, loadManagementDashboard } from '@/lib/dashboard/rules';
import { SupabaseDashboardRepository } from '@/lib/dashboard/supabase-dashboard-repository';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  noStore();
  const session = await requireAdminSession();
  const dashboard = await loadManagementDashboard(new SupabaseDashboardRepository());

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Dashboard gerencial</p>
            <h1>Indicadores operacionais</h1>
            <p className="compact">Sessão administrativa: <strong>{session.trigram}</strong>.</p>
          </div>
          <div className="actions">
            <Link className="button secondary" href="/admin/auditoria">Auditoria nominal</Link>
            <Link className="button secondary" href="/portal">Portal</Link>
          </div>
        </div>

        <section className="stack" aria-labelledby="avop-heading">
          <div>
            <p className="muted">AVOP</p>
            <h2 id="avop-heading">Ciência por aviso</h2>
          </div>
          <div className="grid">
            {dashboard.avops.map((avop) => (
              <article className="card" key={avop.id}>
                <p className="compact muted">{avop.number}</p>
                <h3>{avop.title}</h3>
                <div className="metric-grid">
                  <Metric label="Aplicáveis" value={avop.totalApplicable} />
                  <Metric label="Cientes" value={avop.acknowledged} />
                  <Metric label="Pendentes" value={avop.pending} />
                  <Metric label="Ciência" value={avop.acknowledgementPercent.label} />
                </div>
                <p className="compact">Publicado em: {formatDate(avop.publicationDate)}</p>
                <p className="compact">Status: {avop.status}</p>
                <p className="compact">Denominador: {denominatorLabel(avop.denominatorSource)}</p>
                {avop.hasHistoricalLimitation ? <p className="alert compact">Limitação histórica registrada.</p> : null}
                <Link href={`/admin/auditoria?tipo=avop&id=${encodeURIComponent(avop.id)}`}>Ver nominal</Link>
              </article>
            ))}
          </div>
        </section>

        <section className="stack" aria-labelledby="briefing-heading">
          <div>
            <p className="muted">Aprontos</p>
            <h2 id="briefing-heading">Presença, justificativa e material</h2>
          </div>
          <div className="grid">
            {dashboard.briefings.map((briefing) => (
              <article className="card" key={briefing.id}>
                <p className="compact muted">{briefing.legacyId}</p>
                <h3>{briefing.title}</h3>
                <div className="metric-grid">
                  <Metric label="Aplicáveis" value={briefing.totalApplicable} />
                  <Metric label="Presentes" value={briefing.present} />
                  <Metric label="Ausentes" value={briefing.absent} />
                  <Metric label="Justificados" value={briefing.justified} />
                  <Metric label="Pendentes" value={briefing.pending} />
                  <Metric label="Material" value={briefing.materialAcknowledgedPercent.label} />
                </div>
                <p className="compact">Data: {formatNullableDate(briefing.eventDate)}</p>
                <p className="compact">Status persistido: {briefing.status}</p>
                <p className="compact">Status efetivo: {briefing.effectiveStatus}</p>
                <p className="compact">Denominador: {denominatorLabel(briefing.denominatorSource)}</p>
                {briefing.hasHistoricalLimitation ? <p className="alert compact">Limitação histórica registrada.</p> : null}
                <Link href={`/admin/auditoria?tipo=briefing&id=${encodeURIComponent(briefing.id)}`}>Ver nominal</Link>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatNullableDate(value: string | null): string {
  return value ? formatDate(value) : 'Sem data';
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}
