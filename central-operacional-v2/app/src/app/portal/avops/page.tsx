import Link from 'next/link';
import { requireSession } from '@/lib/auth/server';
import { getAcknowledgementLabel, getAvopSituation, isValidDriveUrl } from '@/lib/avops/rules';
import { listApplicableAvopsForSession, listPublishedAvopsForSession } from '@/lib/avops/service';
import { SupabaseAvopRepository } from '@/lib/avops/supabase-avop-repository';

export const dynamic = 'force-dynamic';

type AvopsPageProps = {
  searchParams?: Promise<{ ack?: string | string[]; error?: string | string[]; view?: string | string[] }>;
};

export default async function AvopsPage({ searchParams }: AvopsPageProps) {
  const session = await requireSession();
  const params = searchParams ? await searchParams : {};
  const ack = Array.isArray(params.ack) ? params.ack[0] : params.ack;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  const showAll = view === 'all';
  const repository = new SupabaseAvopRepository();
  const avops = showAll
    ? await listPublishedAvopsForSession(session, repository)
    : await listApplicableAvopsForSession(session, repository);

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Módulo AVOP</p>
            <h1>{showAll ? 'Todos os AVOPs publicados' : 'AVOPs do seu perfil'}</h1>
            <p className="muted">
              {showAll
                ? 'Catálogo completo para consulta. A ciência continua disponível somente nos AVOPs relacionados ao seu perfil no QT.'
                : 'AVOPs relacionados ao seu perfil no QT.'}
            </p>
          </div>
          <Link className="button secondary" href="/portal">Voltar ao portal</Link>
        </div>

        {ack === 'ok' ? <p className="success" role="status">Ciência registrada. AVOP assinado.</p> : null}
        {error === 'ack' ? (
          <p className="alert" role="alert">
            Não foi possível registrar a ciência. Confira se o AVOP está disponível e tente novamente.
          </p>
        ) : null}

        {avops.length === 0 ? (
          <p className="muted">Nenhum AVOP aplicável encontrado para seu perfil atual.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>AVOP</th>
                  <th>Emissão</th>
                  <th>Situação</th>
                  <th>Ciência</th>
                  <th>Documento</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {avops.map((avop) => {
                  const acknowledged = Boolean(avop.acknowledgement);
                  const validDocument = isValidDriveUrl(avop.driveUrl);
                  return (
                    <tr key={avop.id}>
                      <td>
                        <strong>{avop.number}</strong>
                        <br />
                        <span className="muted">{avop.title}</span>
                      </td>
                      <td>{formatDate(avop.publicationDate)}</td>
                      <td>{getAvopSituation(avop.status)}</td>
                      <td>
                        <span className={acknowledged ? 'badge ok' : avop.applicable ? 'badge pending' : 'badge'}>
                          {avop.applicable || acknowledged ? getAcknowledgementLabel(avop) : 'Não se aplica'}
                        </span>
                      </td>
                      <td>
                        {validDocument && avop.driveUrl ? (
                          <a className="button secondary" href={avop.driveUrl} target="_blank" rel="noopener noreferrer">
                            Abrir documento
                          </a>
                        ) : (
                          <span className="muted">Documento indisponível</span>
                        )}
                      </td>
                      <td>
                        {!avop.applicable ? (
                          <span className="muted">Consulta disponível. Ciência restrita ao público relacionado.</span>
                        ) : acknowledged ? (
                          <button className="button secondary" type="button" disabled>AVOP assinado</button>
                        ) : (
                          <form action="/api/avops/acknowledge" method="post">
                            <input type="hidden" name="avopId" value={avop.id} />
                            <p className="muted compact">Confirmo que li o AVOP e registro minha ciência.</p>
                            <button className="button" type="submit" disabled={!validDocument || avop.status !== 'PUBLISHED'}>
                              Registrar ciência
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="actions">
          {showAll ? (
            <Link className="button secondary" href="/portal/avops">Mostrar AVOPs do meu perfil</Link>
          ) : (
            <Link className="button secondary" href="/portal/avops?view=all">Ver todos os AVOPs</Link>
          )}
        </div>
      </section>
    </main>
  );
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}
