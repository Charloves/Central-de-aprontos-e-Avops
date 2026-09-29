export function environmentCopy(environment: string | undefined) {
  if (environment === 'production') {
    return {
      homeDescription: 'Central Operacional V2 em ambiente de produção do 1º/11º GAV.',
      sessionLabel: 'Sessão da Central Operacional V2',
      portalDescription: 'Sessão protegida por cookie HttpOnly, com acesso aos módulos operacionais autorizados para o perfil.',
    };
  }

  return {
    homeDescription: 'Nova versão em ambiente isolado de desenvolvimento. A Central atual e a planilha oficial permanecem preservadas até a homologação e a aprovação formal.',
    sessionLabel: 'Sessão V2 de homologação',
    portalDescription: 'Esta tela usa sessão protegida por cookie HttpOnly para validação dos módulos da V2.',
  };
}
