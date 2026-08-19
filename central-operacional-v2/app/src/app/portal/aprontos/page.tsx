import Link from 'next/link';
import { requireSession } from '@/lib/auth/server';
import {
  getAttendanceLabel,
  getBriefingStatusLabel,
  getJustificationLabel,
  getMaterialLabel,
  isValidBriefingMaterialUrl,
  MAX_JUSTIFICATION_LENGTH,
  MIN_JUSTIFICATION_LENGTH,
} from '@/lib/briefings/rules';
import { getBriefingActionState, listApplicableBriefingsForSession } from '@/lib/briefings/service';
import { SupabaseBriefingRepository } from '@/lib/briefings/supabase-briefing-repository';

export const dynamic = 'force-dynamic';

type BriefingsPageProps = {
  searchParams?: Promise<{ material?: string | string[]; justification?: string | string[]; error?: string | string[] }>;
};

export default async function BriefingsPage({ searchParams }: BriefingsPageProps) {
  const session = await requireSession();
  const params = searchParams ? await searchParams : {};
  const material = Array.isArray(params.material) ? params.material[0] : params.material;
  const justification = Array.isArray(params.justification) ? params.justification[0] : params.justification;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const briefings = await listApplicableBriefingsForSession(session, new SupabaseBriefingRepository());

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Modulo Aprontos</p>
            <h1>Aprontos aplicaveis</h1>
            <p className="muted">Somente aprontos destinados aos seus publicos atuais sao exibidos.</p>
          </div>
          <Link className="button secondary" href="/portal">Voltar ao portal</Link>
        </div>

        {material === 'ok' ? <p className="success" role="status">Ciencia do material registrada.</p> : null}
        {justification === 'ok' ? <p className="success" role="status">Justificativa registrada.</p> : null}
        {error ? (
          <p className="alert" role="alert">
            Nao foi possivel concluir a acao. Confira se o apronto esta disponivel e tente novamente.
          </p>
        ) : null}

        {briefings.length === 0 ? (
          <p className="muted">Nenhum apronto aplicavel encontrado para seu perfil atual.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Apronto</th>
                  <th>Data</th>
                  <th>Publico</th>
                  <th>Situacao</th>
                  <th>Minha situacao</th>
                  <th>Material</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {briefings.map((briefing) => {
                  const validMaterial = isValidBriefingMaterialUrl(briefing.driveUrl);
                  const state = getBriefingActionState(briefing);
                  return (
                    <tr key={briefing.id}>
                      <td>
                        <strong>{briefing.legacyId}</strong>
                        <br />
                        <span className="muted">{briefing.title}</span>
                      </td>
                      <td>{briefing.eventDate ? formatDate(briefing.eventDate) : 'Data invalida'}</td>
                      <td>{briefing.audiences.join(', ') || 'Nao definido'}</td>
                      <td>
                        <span className={briefing.effectiveStatus === 'OPEN' ? 'badge ok' : 'badge pending'}>
                          {getBriefingStatusLabel(briefing.status, briefing.effectiveStatus)}
                        </span>
                      </td>
                      <td>
                        <p className="compact"><strong>{getAttendanceLabel(briefing.record)}</strong></p>
                        <p className="compact muted">{getJustificationLabel(briefing)}</p>
                        <p className="compact muted">{getMaterialLabel(briefing)}</p>
                      </td>
                      <td>
                        {validMaterial && briefing.driveUrl ? (
                          <a className="button secondary" href={briefing.driveUrl} target="_blank" rel="noopener noreferrer">
                            Abrir material
                          </a>
                        ) : (
                          <span className="muted">Material indisponivel</span>
                        )}
                      </td>
                      <td>
                        <form action="/api/aprontos/justify" method="post">
                          <input type="hidden" name="briefingId" value={briefing.id} />
                          <label className="compact" htmlFor={`just-${briefing.id}`}>Justificativa</label>
                          <input
                            className="input"
                            id={`just-${briefing.id}`}
                            maxLength={MAX_JUSTIFICATION_LENGTH}
                            minLength={MIN_JUSTIFICATION_LENGTH}
                            name="text"
                            placeholder="Ex.: escala, missao ou atendimento"
                            disabled={!state.canJustify}
                          />
                          <button className="button secondary" type="submit" disabled={!state.canJustify}>
                            Registrar justificativa
                          </button>
                        </form>

                        {briefing.requiresMaterialAcknowledgement ? (
                          briefing.record?.materialAcknowledged ? (
                            <button className="button secondary" type="button" disabled>Material ciente</button>
                          ) : (
                            <form action="/api/aprontos/material" method="post">
                              <input type="hidden" name="briefingId" value={briefing.id} />
                              <p className="muted compact">Confirmo que consultei o material deste apronto.</p>
                              <button className="button" type="submit" disabled={!state.canAcknowledgeMaterial}>
                                Registrar ciencia do material
                              </button>
                            </form>
                          )
                        ) : (
                          <p className="muted compact">Este apronto nao exige ciencia formal do material.</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}
