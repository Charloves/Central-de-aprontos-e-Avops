type HomePageProps = {
  searchParams?: Promise<{ error?: string | string[] }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = searchParams ? await searchParams : {};
  const error = Array.isArray(params.error) ? params.error[0] : params.error;

  return (
    <main className="shell">
      <section className="panel">
        <p className="muted">1o/11o GAV</p>
        <h1>Central Operacional V2</h1>
        <p>
          Nova versao em desenvolvimento isolado. A Central atual e a planilha oficial permanecem preservadas ate a
          homologacao e aprovacao formal.
        </p>

        <form className="grid" action="/api/auth/login" method="post">
          <label>
            <strong>Trigrama</strong>
            <input
              autoComplete="off"
              className="input"
              name="trigram"
              pattern="[A-Za-z0-9]{2,8}"
              placeholder="Ex.: CHA"
              required
              maxLength={8}
            />
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button className="button" type="submit">Acessar ambiente V2</button>
          </div>
        </form>

        {error ? (
          <p className="alert" role="alert">
            Nao foi possivel iniciar a sessao. Confira o trigrama e tente novamente.
          </p>
        ) : null}

        <div className="grid" style={{ marginTop: 24 }}>
          <article className="card">
            <h2>AVOP</h2>
            <p className="muted">Ciencia explicita, cobranca automatica e auditoria.</p>
          </article>
          <article className="card">
            <h2>Aprontos</h2>
            <p className="muted">Presenca, justificativa e fechamento automatico.</p>
          </article>
          <article className="card">
            <h2>OI</h2>
            <p className="muted">Busca por aeronave, fase, missao e codigo-base.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
