export function environmentCopy(environment: string | undefined) {
  if (environment === 'production') {
    return {
      homeDescription: 'Central Operacional V2 em ambiente de produção do 1º/11º GAV.',
      sessionLabel: 'Central Operacional - 1º/11º GAV',
    };
  }

  return {
    homeDescription: 'Nova versão em ambiente isolado de desenvolvimento. A Central atual e a planilha oficial permanecem preservadas até a homologação e a aprovação formal.',
    sessionLabel: 'Sessão V2 de homologação',
  };
}
