import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminSession } from '@/lib/auth/server';
import { SupabaseLegacyImportRepository } from '@/lib/admin/supabase-legacy-import-repository';
import type { SheetKind } from '@/lib/importers/types';

export const dynamic = 'force-dynamic';

type ImportPageProps = {
  searchParams?: Promise<{
    batch?: string | string[];
    error?: string | string[];
    applied?: string | string[];
    canceled?: string | string[];
  }>;
};

const IMPORT_OPTIONS: Array<{ kind: SheetKind; label: string; help: string }> = [
  { kind: 'EFETIVO', label: 'Efetivo', help: 'Perfis comuns, públicos e papel USER. ADMIN nunca é criado por importação.' },
  { kind: 'AVOPS', label: 'AVOPs', help: 'Registros operacionais de AVOP e públicos aplicáveis.' },
  { kind: 'LEITURAS', label: 'Leituras de AVOP', help: 'Ciências históricas vinculadas a perfil e AVOP já existentes.' },
  { kind: 'APRONTOS', label: 'Aprontos', help: 'Registros de aprontos e seus públicos.' },
  { kind: 'PRESENCAS', label: 'Presenças', help: 'Presença, falta, justificativa e ciência de material sem inventar campos vazios.' },
  { kind: 'OI_H50', label: 'OI H50', help: 'Ordens de Instrução da aeronave H50.' },
  { kind: 'OI_H125', label: 'OI H125', help: 'Ordens de Instrução da aeronave H125.' },
  { kind: 'EMAIL_LOG', label: 'Log de e-mail', help: 'Histórico legado preservado em staging quando houver ambiguidade.' },
  { kind: 'ACESSOS_LOG', label: 'Log de acessos', help: 'Histórico legado de acessos preservado de forma sanitizada.' },
];

export default async function AdminImportPage({ searchParams }: ImportPageProps) {
  noStore();
  const session = await requireAdminSession();
  if (!session.roles.includes('ADMIN')) redirect('/admin?error=forbidden');

  const params = searchParams ? await searchParams : {};
  const batchId = firstParam(params.batch);
  const error = firstParam(params.error);
  const repository = new SupabaseLegacyImportRepository();
  const batch = batchId ? await repository.findBatch(batchId).catch(() => null) : null;

  return (
    <main className="shell">
      <section className="panel stack">
        <div className="topbar">
          <div>
            <p className="muted">Área administrativa</p>
            <h1>Importação segura de dados legados</h1>
          </div>
          <Link href="/admin/perfis">Voltar</Link>
        </div>

        <p className="compact">
          O envio abaixo gera apenas pré-visualização e staging. A escrita definitiva nas tabelas operacionais exige
          confirmação explícita e usa transação no banco. Todo conteúdo importado é tratado como não confiável.
        </p>

        {error ? <p className="alert" role="alert">Não foi possível processar a importação. Revise o arquivo e tente novamente.</p> : null}
        {firstParam(params.applied) ? <p className="success" role="status">Lote aplicado com auditoria registrada.</p> : null}
        {firstParam(params.canceled) ? <p className="success" role="status">Lote cancelado sem escrita operacional.</p> : null}

        <form className="grid" action="/api/admin/importacao/preview" method="post" encType="multipart/form-data">
          <label>
            <strong>Tipo de planilha</strong>
            <select className="input" name="kind" required>
              {IMPORT_OPTIONS.map((option) => (
                <option key={option.kind} value={option.kind}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <strong>Arquivo CSV ou JSON</strong>
            <input className="input" name="file" type="file" accept=".csv,.json,text/csv,application/json" required />
          </label>
          <div>
            <button className="button" type="submit">Validar e pré-visualizar</button>
          </div>
        </form>

        <div className="grid">
          {IMPORT_OPTIONS.map((option) => (
            <article className="card" key={option.kind}>
              <h2>{option.label}</h2>
              <p>{option.help}</p>
            </article>
          ))}
        </div>

        {batch ? (
          <section className="panel stack" aria-label="Resumo do lote validado">
            <div>
              <p className="muted">Lote validado</p>
              <h2>{batch.sourceFileName}</h2>
              <p className="compact">
                Status: <strong>{batch.status}</strong>. Hash do arquivo e token de confirmação ficam no servidor; valores
                sensíveis não são exibidos.
              </p>
            </div>

            <div className="grid">
              <Metric label="Lidas" value={batch.report.totals.read} />
              <Metric label="Válidas" value={batch.report.totals.valid} />
              <Metric label="Inválidas" value={batch.report.totals.invalid} />
              <Metric label="Duplicadas" value={batch.report.totals.duplicates} />
            </div>

            <h3>Inconsistências</h3>
            {Object.keys(batch.report.issuesByCategory).length ? (
              <ul>
                {Object.entries(batch.report.issuesByCategory).map(([code, total]) => (
                  <li key={code}>{code}: {total}</li>
                ))}
              </ul>
            ) : (
              <p className="success">Nenhuma inconsistência bloqueante detectada.</p>
            )}

            <h3>Amostras sanitizadas</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Classificação</th>
                    <th>Operação</th>
                    <th>Amostra</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.report.sheets.flatMap((sheet) => sheet.operations.slice(0, 20)).map((operation) => (
                    <tr key={operation.idempotencyKeyHash}>
                      <td>{String(operation.sample.rowNumber ?? '-')}</td>
                      <td>{operation.classification}</td>
                      <td>{operation.operation}</td>
                      <td><code>{JSON.stringify(operation.sample)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p>
              <a href={`/api/admin/importacao/report?batch=${encodeURIComponent(batch.batchId)}`}>Baixar relatório sanitizado</a>
            </p>

            <div className="actions">
              <form action="/api/admin/importacao/apply" method="post">
                <input type="hidden" name="batchId" value={batch.batchId} />
                <button className="button" type="submit" disabled={!batch.report.canApply || batch.status !== 'VALIDATED'}>
                  Confirmar aplicação transacional
                </button>
              </form>
              <form action="/api/admin/importacao/cancel" method="post">
                <input type="hidden" name="batchId" value={batch.batchId} />
                <button className="button secondary" type="submit" disabled={batch.status !== 'VALIDATED'}>Cancelar lote</button>
              </form>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="card">
      <p className="muted">{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
