export function environmentCopy(environment: string | undefined) {
  if (environment === 'production') {
    return {
      sessionLabel: 'Central Operacional - 1º/11º GAV',
    };
  }

  return {
    sessionLabel: 'Sessão V2 de homologação',
  };
}
