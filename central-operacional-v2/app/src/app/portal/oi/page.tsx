import Link from 'next/link';
import { requireSession } from '@/lib/auth/server';
import { formatOiAircraft, formatPageRange, normalizeOiAircraft } from '@/lib/ois/rules';
import { searchOiForSession } from '@/lib/ois/service';
import { SupabaseOiRepository } from '@/lib/ois/supabase-oi-repository';
import type { OiSearchItem, OiSearchResponse } from '@/lib/ois/types';

export const dynamic = 'force-dynamic';

type OiPageProps = {
  searchParams?: Promise<{ aircraft?: string | string[]; q?: string | string[] }>;
};

export default async function OiPage({ searchParams }: OiPageProps) {
  const session = await requireSession();
  const params = searchParams ? await searchParams : {};
  const aircraftParam = Array.isArray(params.aircraft) ? params.aircraft[0] : params.aircraft;
  const queryParam = Array.isArray(params.q) ? params.q[0] : params.q;
  const aircraft = normalizeOiAircraft(aircraftParam) ?? 'H50';
  const result = await searchOiForSession({
    session,
    repository: new SupabaseOiRepository(),
    aircraft,
    query: queryParam ?? '',
  });

  return (
    <main className="shell">
      <section className="panel">
        <div className="topbar">
          <div>
            <p className="muted">Módulo OI</p>
            <h1>Consulta de Ordens de Instrução</h1>
            <p className="muted">Informe a aeronave e o código completo, código-base ou tipo de missão.</p>
          </div>
          <Link className="button secondary" href="/portal">Voltar ao portal</Link>
        </div>

        <form className="stack" method="get" action="/portal/oi">
          <label>
            Aeronave
            <select className="input" name="aircraft" defaultValue={aircraft}>
              <option value="H50">H-50</option>
              <option value="H125">H-125</option>
            </select>
          </label>
          <label>
            Código ou tipo de missão
            <input
              className="input"
              maxLength={80}
              name="q"
              placeholder="Ex.: 01HE01D07, 01HE01 ou adaptação diurna"
              defaultValue={typeof queryParam === 'string' ? queryParam : ''}
            />
          </label>
          <div className="actions">
            <button className="button" type="submit">Buscar OI</button>
            <Link className="button secondary" href="/portal/oi">Limpar consulta</Link>
          </div>
        </form>

        <OiSearchFeedback result={result} />
      </section>
    </main>
  );
}

function OiSearchFeedback({ result }: { result: OiSearchResponse }) {
  if (!result.ok) {
    return (
      <p className="alert" role="alert">
        Não foi possível realizar a consulta. Confira os dados informados e tente novamente.
      </p>
    );
  }

  if (result.status === 'empty') {
    return (
      <p className="muted">
        Selecione a aeronave, informe o código ou tipo de missão e clique em Buscar OI.
      </p>
    );
  }

  if (result.status === 'not_found') {
    return (
      <p className="alert" role="status">
        Nenhuma OI ativa encontrada para {formatOiAircraft(result.aircraft)} com a consulta informada.
      </p>
    );
  }

  const intro = result.status === 'single'
    ? 'Foi encontrada uma OI ativa.'
    : 'A consulta retornou mais de uma opção. Confira os dados abaixo antes de abrir o documento.';

  return (
    <section className="stack" aria-label="Resultado da consulta OI">
      <p className={result.status === 'single' ? 'success' : 'alert'} role="status">{intro}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>OI</th>
              <th>Programa</th>
              <th>Fase</th>
              <th>Missões</th>
              <th>Páginas</th>
              <th>Documento</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => (
              <OiResultRow key={`${item.aircraft}|${item.oiKey}|${item.startPage}|${item.driveFileId ?? ''}`} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OiResultRow({ item }: { item: OiSearchItem }) {
  return (
    <tr>
      <td>
        <strong>{formatOiAircraft(item.aircraft)} - {item.oiKey}</strong>
        <br />
        <span className="muted">{item.title}</span>
        <br />
        <span className="muted">{item.displayKey}</span>
      </td>
      <td>
        <strong>{item.program}</strong>
        <br />
        <span className="muted">{item.subprogram}</span>
      </td>
      <td>{item.phaseId}</td>
      <td>{item.missionCodes.length ? item.missionCodes.join(', ') : 'Sem lista de missões'}</td>
      <td>{formatPageRange(item.startPage, item.endPage)}</td>
      <td>
        {item.documentUrlValid ? (
          <>
            <a className="button secondary" href={item.driveUrl} target="_blank" rel="noopener noreferrer">
              Abrir OI
            </a>
            <p className="muted compact">Abrir o documento não registra ciência.</p>
          </>
        ) : (
          <span className="muted">Link indisponível</span>
        )}
      </td>
    </tr>
  );
}
