export default function HomePage() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="muted">1º/11º GAV</p>
        <h1>Central Operacional V2</h1>
        <p>
          Nova versão em desenvolvimento isolado. A Central atual e a planilha oficial permanecem preservadas até a
          homologação e aprovação formal.
        </p>

        <form className="grid" action="/portal">
          <label>
            <strong>Trigrama</strong>
            <input className="input" name="trigram" placeholder="Ex.: CHA" maxLength={8} />
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button className="button" type="submit">Acessar ambiente V2</button>
          </div>
        </form>

        <div className="grid" style={{ marginTop: 24 }}>
          <article className="card">
            <h2>AVOP</h2>
            <p className="muted">Ciência explícita, cobrança automática e auditoria.</p>
          </article>
          <article className="card">
            <h2>Aprontos</h2>
            <p className="muted">Presença, justificativa e fechamento automático.</p>
          </article>
          <article className="card">
            <h2>OI</h2>
            <p className="muted">Busca por aeronave, fase, missão e código-base.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
