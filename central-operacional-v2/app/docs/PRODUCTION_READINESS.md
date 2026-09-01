# Preparação controlada para produção

Este roteiro prepara a Central Operacional V2 para produção sem criar recursos, sem aplicar migrations e sem executar deploy. A Central atual em Apps Script permanece preservada até aprovação formal.

## Estado técnico revisado

- Vercel: a aplicação usa `Root Directory` `central-operacional-v2/app`, preset Next.js, `npm ci`, `npm run build` e Node.js `22.x`.
- Runtime: `package.json` fixa `engines.node` em `22.x`; o build Next.js não depende de caminhos locais Windows.
- Cookies: a sessão é opaca e `HttpOnly`; em produção o cookie usa `Secure`, `SameSite=Lax`, `Path=/` e expiração configurável.
- CSRF: endpoints mutáveis validam `APP_ORIGIN`; em produção, origem ausente, malformada ou divergente falha fechada.
- Supabase: a V2 usa somente backend server-side com `SUPABASE_SECRET_KEY`; não há acesso direto do navegador às tabelas.
- RLS e grants: migrations já aplicadas habilitam RLS nas tabelas públicas, revogam acesso de `PUBLIC`, `anon` e `authenticated` e preservam acesso backend pelo `service_role` quando necessário.
- Cron: `/api/cron/avop-notifications` exige `CRON_SECRET`, retorna `Cache-Control: no-store` e falha fechado quando o segredo está ausente ou divergente.
- Gmail: envio real só ocorre quando `AVOP_EMAIL_MODE=gmail`; o primeiro deploy de produção deve permanecer com `AVOP_EMAIL_MODE=dry-run`.
- Logs: erros externos são genéricos; credenciais, tokens, cookies, hashes e segredos não devem ser registrados.

## Validador sanitizado

Execute localmente ou em ambiente controlado:

```powershell
npm run production:check
```

O comando imprime apenas estados como `valid`, `missing`, `present`, `dry-run` ou `gmail`. Ele não imprime valores de segredos, tokens, URLs completas, project refs, cookies ou chaves.

O validador rejeita:

- `APP_ENV` diferente de `production`;
- `SUPABASE_TARGET_ENV` diferente de `production`;
- `APP_ORIGIN`, `APP_BASE_URL` ou `SUPABASE_URL` com HTTP ou host local;
- `SUPABASE_URL` que não corresponda a `SUPABASE_PRODUCTION_PROJECT_REF`;
- projeto Supabase de produção igual ao `SUPABASE_DEV_PROJECT_REF`;
- `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `AUTH_FINGERPRINT_SECRET` ou `CRON_SECRET` ausentes, fracos ou reutilizados;
- `SUPABASE_SECRET_KEY` fora do formato `sb_secret_...`;
- `AVOP_EMAIL_MODE=gmail` sem configuração completa do Gmail;
- variáveis `NEXT_PUBLIC_*` com nomes que indiquem segredos, tokens, chaves, cookies, Supabase, Gmail ou cron.

## Variáveis da Vercel para produção

Configure manualmente no painel da Vercel, sem copiar valores para Git, issue, chat ou documentação.

| Variável | Obrigatória | Secreta | Regra |
| --- | --- | --- | --- |
| `APP_ENV` | Sim | Não | `production` |
| `APP_ORIGIN` | Sim | Não sensível | Origem HTTPS exata do domínio de produção, sem barra final |
| `APP_BASE_URL` | Opcional | Não sensível | Se configurada, mesma origem de `APP_ORIGIN` |
| `SUPABASE_URL` | Sim | Não secreta | URL HTTPS do projeto Supabase de produção |
| `SUPABASE_SECRET_KEY` | Sim | Sim | Chave `sb_secret_...` exclusiva do backend de produção |
| `SUPABASE_TARGET_ENV` | Sim | Não | `production` |
| `SUPABASE_PRODUCTION_PROJECT_REF` | Sim | Operacional | Project ref do Supabase de produção |
| `SUPABASE_DEV_PROJECT_REF` | Sim para validação | Operacional | Project ref do development para impedir troca acidental |
| `SESSION_SECRET` | Sim | Sim | Forte, exclusivo e diferente dos demais |
| `AUTH_FINGERPRINT_SECRET` | Sim | Sim | Forte, exclusivo e diferente de `SESSION_SECRET` |
| `SESSION_DURATION_SECONDS` | Sim | Não | Inicial recomendado: `28800` |
| `SESSION_TOUCH_INTERVAL_SECONDS` | Sim | Não | Inicial recomendado: `300` |
| `LOGIN_MAX_ATTEMPTS` | Sim | Não | Inicial recomendado: `5` |
| `LOGIN_WINDOW_SECONDS` | Sim | Não | Inicial recomendado: `900` |
| `LOGIN_BLOCK_SECONDS` | Sim | Não | Inicial recomendado: `900` |
| `AUTH_RATE_LIMIT_TRIGRAM_ENABLED` | Sim | Não | `true` |
| `AUTH_RATE_LIMIT_NETWORK_ENABLED` | Sim | Não | `true`, salvo decisão formal de desabilitar escopo de rede |
| `AVOP_EMAIL_MODE` | Sim | Não | Primeiro deploy: `dry-run` |
| `CRON_SECRET` | Sim | Sim | Forte e exclusivo |
| `GMAIL_CLIENT_ID` | Antes de Gmail real | Operacional | Necessário apenas para `AVOP_EMAIL_MODE=gmail` |
| `GMAIL_CLIENT_SECRET` | Antes de Gmail real | Sim | Necessário apenas para `AVOP_EMAIL_MODE=gmail` |
| `GMAIL_REFRESH_TOKEN` | Antes de Gmail real | Sim | Necessário apenas para `AVOP_EMAIL_MODE=gmail` |
| `GMAIL_SENDER_EMAIL` | Antes de Gmail real | Não sensível | E-mail simples da conta funcional |
| `GMAIL_SENDER_NAME` | Antes de Gmail real | Não sensível | Nome exibido, sem caracteres de controle |

Nunca configurar segredos como `NEXT_PUBLIC_*`.

## Supabase produção

1. Criar um projeto Supabase novo e exclusivo para produção.
2. Registrar o project ref em `SUPABASE_PRODUCTION_PROJECT_REF`.
3. Confirmar que `SUPABASE_PRODUCTION_PROJECT_REF` é diferente de `SUPABASE_DEV_PROJECT_REF`.
4. Configurar `SUPABASE_URL` e `SUPABASE_SECRET_KEY` de produção somente na Vercel.
5. Aplicar as migrations sequencialmente em projeto vazio e validado.
6. Não aplicar `supabase/seed.sql` em produção. O seed contém dados fictícios de desenvolvimento.
7. Executar Security Advisor e Performance Advisor após as migrations.
8. Validar RLS, grants, RPCs, cron e logs antes de liberar usuários.

## Bootstrap do primeiro administrador

Após aplicar as migrations em produção e antes de liberar usuários, criar exatamente um primeiro administrador pelo script server-only:

```powershell
npm run production:bootstrap-admin
```

O script é idempotente e falha fechado quando:

- `APP_ENV` não é exatamente `production`;
- `SUPABASE_TARGET_ENV` não é exatamente `production`;
- `SUPABASE_URL` não corresponde a `SUPABASE_PRODUCTION_PROJECT_REF`;
- `SUPABASE_PRODUCTION_PROJECT_REF` coincide com `SUPABASE_DEV_PROJECT_REF`;
- `SUPABASE_SECRET_KEY` não usa a chave moderna `sb_secret_...`;
- já existe perfil ativo com `ADMIN`.

Entradas do primeiro administrador devem ser fornecidas somente por ambiente local seguro ou mecanismo operacional equivalente:

- `BOOTSTRAP_ADMIN_TRIGRAM`;
- `BOOTSTRAP_ADMIN_NAME`;
- `BOOTSTRAP_ADMIN_EMAIL`;
- `BOOTSTRAP_ADMIN_AUDIENCES`, com códigos separados por vírgula.

Esses valores não devem ser enviados por chat, não devem ser gravados em Git, não devem ser impressos em logs e não substituem o `seed.sql`. O script chama a RPC `bootstrap_first_admin`, que cria o perfil com `USER`, `COORDINATOR` e `ADMIN`, associa públicos válidos e registra auditoria nominal.

Depois do bootstrap, a gestão ordinária de perfis ocorre apenas em `/admin/perfis`. Essa tela exige `ADMIN`, não concede `ADMIN` e não remove o último administrador ativo. Concessão ou transferência de `ADMIN` permanece restrita ao fluxo de transferência administrativa existente.

## Migrations

Aplicar somente as migrations versionadas, em ordem, usando o fluxo controlado da Supabase CLI contra o projeto de produção. Não usar `db reset`, `repair`, `pull` ou SQL Editor para contornar falhas sem diagnóstico.

Antes da aplicação:

- confirmar `SUPABASE_TARGET_ENV=production`;
- confirmar project ref de produção;
- executar dry-run e revisar a lista exata;
- confirmar que `seed.sql` não será incluído.

Depois da aplicação:

- listar migrations local/remoto;
- validar índices, RLS, grants, funções `SECURITY DEFINER`, `search_path` e default privileges;
- executar advisors.

## Primeiro deploy

O primeiro deploy de produção deve usar:

- `AVOP_EMAIL_MODE=dry-run`;
- `CRON_SECRET` forte configurado;
- Gmail real configurado apenas se necessário para validação posterior, mas sem ativar `gmail`;
- domínio HTTPS definitivo em `APP_ORIGIN`.

Com `AVOP_EMAIL_MODE=dry-run`, o cron pode executar a seleção e registro controlado de notificações sem acionar Gmail real. A troca para `gmail` exige autorização operacional separada, smoke test e confirmação de templates.

## Smoke test

Após deploy e migrations:

1. Acessar `/` e validar carregamento sem erro.
2. Login com perfil administrativo autorizado.
3. Validar `/portal`, `/admin`, `/admin/dashboard`, `/admin/auditoria` e `/admin/perfis`.
4. Validar AVOP, Apronto e OI somente com dados de produção aprovados.
5. Confirmar cookie `HttpOnly`, `Secure`, `SameSite=Lax` e opaco.
6. Testar logout e revogação de sessão.
7. Validar que usuário comum não acessa área administrativa.
8. Executar chamada controlada ao cron sem segredo e confirmar `403`.
9. Executar chamada controlada ao cron com segredo somente se houver autorização de escrita em produção.
10. Conferir logs da Vercel sem segredos ou dados sensíveis.

## Rollback

- Se a falha for de aplicação, promover o deployment anterior estável na Vercel.
- Se a falha envolver variáveis, corrigir variáveis no painel e redeployar.
- Se a falha envolver migration já aplicada, não executar `db reset`; criar migration corretiva após diagnóstico.
- Se houver risco de envio indevido, manter ou retornar `AVOP_EMAIL_MODE=dry-run` imediatamente.
- Se houver risco de sessão, revogar sessões no banco por IDs exatos e registrar auditoria operacional.

## Bloqueios antes de produção

- Produção não deve compartilhar projeto Supabase com development.
- Produção não deve receber o seed fictício.
- Gmail real não deve ser ativado no primeiro deploy.
- Remoção de índices `unused_index` continua proibida sem workload representativo.
- Qualquer mudança em RLS, grants, cron ou envio Gmail exige revisão separada.
