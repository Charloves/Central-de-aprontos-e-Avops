import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { environmentCopy } from './environment-copy';

function readSource(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('Portuguese user-facing copy', () => {
  it('preserves representative Brazilian Portuguese characters in visible UI copy', () => {
    const home = readSource('app/page.tsx');
    const briefings = readSource('app/portal/aprontos/page.tsx');
    const oiRules = readSource('lib/ois/rules.ts');

    expect(home).toContain('1º/11º GAV');
    expect(home).toContain('Ciência explícita, cobrança automática e auditoria.');
    expect(briefings).toContain('Não foi possível concluir a ação.');
    expect(oiRules).toContain('Página não informada');
  });

  it('distingue textos de produção e homologação sem perder a acentuação', () => {
    expect(environmentCopy('production')).toEqual({
      homeDescription: 'Central Operacional V2 em ambiente de produção do 1º/11º GAV.',
      sessionLabel: 'Sessão da Central Operacional V2',
      portalDescription: 'Sessão protegida por cookie HttpOnly, com acesso aos módulos operacionais autorizados para o perfil.',
    });
    expect(environmentCopy('development')).toEqual({
      homeDescription: 'Nova versão em ambiente isolado de desenvolvimento. A Central atual e a planilha oficial permanecem preservadas até a homologação e a aprovação formal.',
      sessionLabel: 'Sessão V2 de homologação',
      portalDescription: 'Esta tela usa sessão protegida por cookie HttpOnly para validação dos módulos da V2.',
    });
  });

  it('keeps validation and error messages with UTF-8 accents', () => {
    const login = readSource('lib/auth/login.ts');
    const csrf = readSource('lib/auth/csrf.ts');
    const representative = 'ação, ciência, divulgação, pendência, aviação, instrução, São Paulo e ç';

    expect(login).toContain('Não foi possível iniciar a sessão.');
    expect(login).toContain('Configuração de sessão indisponível.');
    expect(csrf).toContain('Não foi possível processar a requisição.');
    expect(representative).toContain('ação');
    expect(representative).toContain('ciência');
    expect(representative).toContain('divulgação');
    expect(representative).toContain('pendência');
    expect(representative).toContain('aviação');
    expect(representative).toContain('instrução');
    expect(representative).toContain('São Paulo');
    expect(representative).toContain('ç');
  });
});
