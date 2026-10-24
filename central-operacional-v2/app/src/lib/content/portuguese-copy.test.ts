import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { environmentCopy } from './environment-copy';

function readSource(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('Portuguese user-facing copy', () => {
  it('includes the official squadron emblem used by the login page', () => {
    const emblem = new URL('../../../public/bolacha-1-11-gav.jpg', import.meta.url);

    expect(statSync(emblem).size).toBeGreaterThan(0);
  });

  it('preserves representative Brazilian Portuguese characters in visible UI copy', () => {
    const home = readSource('app/page.tsx');
    const layout = readSource('app/layout.tsx');
    const portal = readSource('app/portal/page.tsx');
    const avops = readSource('app/portal/avops/page.tsx');
    const briefings = readSource('app/portal/aprontos/page.tsx');
    const oiRules = readSource('lib/ois/rules.ts');

    expect(home).toContain('1º/11º GAV');
    expect(home).toContain('Central Operacional - 1º/11º GAV');
    expect(home).toContain('Bolacha do 1º/11º GAV');
    expect(home).toContain('CDOUT - 1º/11º GAV');
    expect(home).toContain('>Acessar</button>');
    expect(home).not.toContain('Central Operacional V2');
    expect(home).not.toContain('ambiente de produção');
    expect(home).not.toContain('Acessar ambiente V2');
    expect(layout).toContain("title: 'Central Operacional - 1º/11º GAV'");
    expect(layout).not.toContain("title: 'Central Operacional V2'");
    expect(home).toContain('Ciência explícita, cobrança automática e auditoria.');
    expect(portal).toContain('Bem-vindo, {session.trigram}');
    expect(portal).toContain('ciência sem duplicidade');
    expect(portal).not.toContain('Sessão protegida por cookie HttpOnly');
    expect(portal).not.toContain('ciência idempotente');
    expect(avops).toContain('AVOPs relacionados ao seu perfil no QT.');
    expect(avops).toContain('Ver todos os AVOPs');
    expect(avops).toContain("'Não se aplica'");
    expect(avops).not.toContain('<th>Prazo</th>');
    expect(briefings).toContain('Não foi possível concluir a ação.');
    expect(briefings).toContain('Ordem: presença, justificativa e material.');
    expect(briefings).not.toContain('<th>Público</th>');
    expect(briefings).not.toContain('<th>Situação</th>');
    expect(oiRules).toContain('Página não informada');
  });

  it('distingue textos de produção e homologação sem perder a acentuação', () => {
    expect(environmentCopy('production')).toEqual({
      sessionLabel: 'Central Operacional - 1º/11º GAV',
    });
    expect(environmentCopy('development')).toEqual({
      sessionLabel: 'Sessão V2 de homologação',
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
