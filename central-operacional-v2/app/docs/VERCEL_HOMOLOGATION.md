# Implantação de homologação na Vercel

Este roteiro prepara uma implantação Preview da Central Operacional V2 na Vercel. A etapa usa exclusivamente o projeto Supabase de desenvolvimento, mantém `AVOP_EMAIL_MODE=dry-run` e não utiliza dados oficiais.

## Configuração do projeto

- Repositório GitHub: `Charloves/Central-de-aprontos-e-Avops`.
- Branch: `feature/central-operacional-v2`.
- Root Directory: `central-operacional-v2/app`.
- Framework Preset: `Next.js`.
- Build Command: `npm run build`.
- Output Directory: padrão do Next.js na Vercel.
- Node.js: `22.x`, fixado em `package.json`.

Não execute deploy nesta etapa. A criação do projeto na Vercel deve apontar para a branch acima e para o diretório raiz da aplicação V2.

## Variáveis de ambiente para Preview

Configure as variáveis somente no painel da Vercel, no escopo Preview do projeto de homologação. Não grave valores reais em Git, issues, chat ou documentação.

| Variável | Secreta | Observação |
| --- | --- | --- |
| `APP_ENV` | Não | Usar `development` nesta homologação, pois o banco autorizado é Supabase development. |
| `APP_ORIGIN` | Não sensível | Deve ser a origem HTTPS exata do Preview da Vercel, sem barra final. |
| `SUPABASE_URL` | Não secreta | URL do projeto Supabase development. |
| `SUPABASE_SECRET_KEY` | Sim | Chave `sb_secret_...` exclusiva do backend. Nunca usar `NEXT_PUBLIC_`. |
| `SESSION_SECRET` | Sim | Segredo forte e exclusivo do ambiente. |
| `AUTH_FINGERPRINT_SECRET` | Sim | Segredo forte, diferente de `SESSION_SECRET`. |
| `SESSION_DURATION_SECONDS` | Não | Valor inicial recomendado: `28800`. |
| `LOGIN_MAX_ATTEMPTS` | Não | Valor inicial recomendado: `5`. |
| `LOGIN_WINDOW_SECONDS` | Não | Valor inicial recomendado: `900`. |
| `LOGIN_BLOCK_SECONDS` | Não | Valor inicial recomendado: `900`. |
| `SUPABASE_TARGET_ENV` | Não | Deve permanecer `development` na homologação. |
| `SUPABASE_DEV_PROJECT_REF` | Sim operacional | Usado somente para validar o projeto de desenvolvimento. Não imprimir. |
| `AVOP_EMAIL_MODE` | Não | Deve permanecer `dry-run` na homologação. |
| `CRON_SECRET` | Sim | Segredo forte para o endpoint de cron. |
| `GMAIL_CLIENT_ID` | Sim operacional | Necessário apenas para futura troca controlada para envio real. |
| `GMAIL_CLIENT_SECRET` | Sim | Nunca expor ao navegador. |
| `GMAIL_REFRESH_TOKEN` | Sim | Nunca expor ao navegador. |
| `GMAIL_SENDER_EMAIL` | Não sensível | Configurar no ambiente; não deixar fallback em código. |
| `GMAIL_SENDER_NAME` | Não sensível | Configurar no ambiente. |

Nenhuma variável secreta deve usar prefixo `NEXT_PUBLIC_`. A V2 atual usa banco somente pelo backend com `SUPABASE_SECRET_KEY` em módulos `server-only`.

## Cron de notificações AVOP

A Vercel invoca Cron Jobs por `GET` na URL de produção do deployment e envia `Authorization: Bearer $CRON_SECRET`. O endpoint preparado é:

- Path: `/api/cron/avop-notifications`.
- Schedule: `0 11 * * *`.

O horário da Vercel Cron é UTC. `0 11 * * *` corresponde a 08:00 em `America/Sao_Paulo` no fuso atual UTC-3. Se a regra oficial de fuso voltar a mudar, o agendamento deverá ser revisado.

Preview Deployments não disparam Cron Jobs automaticamente na Vercel. Mesmo assim, a variável `CRON_SECRET` deve estar configurada para que chamadas manuais de homologação falhem fechadas quando não autorizadas.

Na homologação, `AVOP_EMAIL_MODE` deve permanecer `dry-run`: o job pode reservar e registrar simulações conforme autorização explícita, mas não deve acionar Gmail.

## Checklist antes do deploy

1. Confirmar Root Directory `central-operacional-v2/app`.
2. Confirmar branch `feature/central-operacional-v2`.
3. Confirmar Node.js `22.x`.
4. Configurar `APP_ORIGIN` com a origem HTTPS exata do Preview.
5. Configurar somente Supabase development.
6. Confirmar `AVOP_EMAIL_MODE=dry-run`.
7. Confirmar que não há variável secreta com prefixo `NEXT_PUBLIC_`.
8. Confirmar que `.env.local` não foi versionado.
9. Confirmar que a Central atual em Apps Script e a planilha oficial não participam do deploy.
10. Registrar como pendência antes de produção o índice de apoio para `notification_log.profile_id`.

## Retorno

Como esta etapa não executa deploy nem muda banco, o retorno é remover a configuração de projeto na Vercel ou descartar o Preview. Nenhum dado oficial deve ser usado na homologação.
