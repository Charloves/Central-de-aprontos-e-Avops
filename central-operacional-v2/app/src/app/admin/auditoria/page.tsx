import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { requireAdminSession } from '@/lib/auth/server';
import {
  AUDIT_DEFAULT_PAGE_SIZE,
  auditSituationLabel,
  denominatorLabel,
  loadManagementDashboard,
  loadNominalAudit,
} from '@/lib/dashboard/rules';
import { SupabaseDashboardRepository } from '@/lib/dashboard/supabase-dashboard-repository';
import type { AuditItemType } from '@/lib/dashboard/types';

export const dynamic = 'force-dynamic';

type AuditPageProps = {
  searchParams?: Promise<{
    tipo?: string | string[];
    id?: string | string[];
    page?: string | string[];
  }>;
};

export default async function AdminAuditPage({ searchParams }: AuditPageProps) {
  noStore();
  const session = await requireAdminSession();
  const params = searchParams ? await searchParams : {};
  const selectedType = firstParam(params.tipo);
  const selectedId = firstParam(params.id);
  const page = parsePositiveInt(firstParam(params.page)) ?? 1;
  const repository = new SupabaseDashboardRepository();
  const dashboard = await loadManagementDashboard(repository);
  const itemType = parseItemType(selectedType);
  const audit = itemType && selectedId
    ? await loadNominalAudit({ repository, itemType, itemId: selectedId, page, pageSize: AUDIT_DEFAULT_PAGE_SIZE })
    : null;

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Auditoria nominal</p>
            <h1>Conferência por militar</h1>
            <p className="compact">Sessão administrativa: <strong>{session.trigram}</strong>.</p>
          </div>
          <div className="actions">
            <Link className="button secondary" href="/admin/dashboard">Dashboard</Link>
            <Link className="button secondary" href="/portal">Portal</Link>
          </div>
        </div>

        <form className="grid audit-filter">
          <label>
            <strong>Tipo</strong>
            <select className="input" name="tipo" defaultValue={itemType ?? ''}>
              <option value="">Selecione</option>
              <option value="avop">AVOP</option>
              <option value="briefing">Apronto</option>
            </select>
          </label>
          <label>
            <strong>Item</strong>
            <select className="input" name="id" defaultValue={selectedId ?? ''}>
              <option value="">Selecione</option>
              <optgroup label="AVOP">
                {dashboard.avops.map((avop) => (
                  <option key={avop.id} value={avop.id}>{avop.number} - {avop.title}</option>
                ))}
              </optgroup>
              <optgroup label="Apronto">
                {dashboard.briefings.map((briefing) => (
                  <option key={briefing.id} value={briefing.id}>{briefing.legacyId} - {briefing.title}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button className="button" type="submit">Consultar</button>
          </div>
        </form>

        {itemType && selectedId && !audit ? (
          <p className="alert" role="alert">Não foi possível carregar a auditoria solicitada.</p>
        ) : null}

        {audit ? (
          <section className="stack">
            <div>
              <h2>{audit.itemLabel}</h2>
              <p className="compact">Denominador: {denominatorLabel(audit.denominatorSource)}.</p>
              <p className="compact">Total nominal: {audit.totalRows}. Página {audit.page}.</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Trigrama</th>
                    <th>Público</th>
                    <th>Situação</th>
                    <th>Data</th>
                    <th>Limitação</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.rows.map((row) => (
                    <tr key={row.profileId}>
                      <td>{row.name}</td>
                      <td>{row.trigram}</td>
                      <td>{row.audiences.join(', ') || 'Não informado'}</td>
                      <td>
                        <span className={`badge ${row.situation === 'PENDENTE' || row.situation === 'SEM_CLASSIFICACAO' ? 'pending' : 'ok'}`}>
                          {auditSituationLabel(row.situation)}
                        </span>
                        {typeof row.materialAcknowledged === 'boolean' ? (
                          <p className="compact muted">Material: {row.materialAcknowledged ? 'ciente' : 'pendente'}</p>
                        ) : null}
                      </td>
                      <td>{row.eventAt ? formatDateTime(row.eventAt) : 'Sem data'}</td>
                      <td>{row.historicalProfileAvailable ? 'Sem limitação' : row.limitationReason ?? 'Perfil histórico não disponível'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              {audit.page > 1 ? (
                <Link className="button secondary" href={pageHref(audit.itemType, audit.itemId, audit.page - 1)}>Página anterior</Link>
              ) : null}
              {audit.page * audit.pageSize < audit.totalRows ? (
                <Link className="button secondary" href={pageHref(audit.itemType, audit.itemId, audit.page + 1)}>Próxima página</Link>
              ) : null}
            </div>
          </section>
        ) : (
          <p className="muted">Selecione um AVOP ou apronto para consultar a auditoria nominal.</p>
        )}
      </section>
    </main>
  );
}

function parseItemType(value: string | undefined): AuditItemType | null {
  if (value === 'avop' || value === 'briefing') return value;
  return null;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function pageHref(itemType: AuditItemType, itemId: string, page: number): string {
  return `/admin/auditoria?tipo=${itemType}&id=${encodeURIComponent(itemId)}&page=${page}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}
