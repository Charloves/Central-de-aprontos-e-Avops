# Autorizacao OAuth local do Gmail

Este roteiro prepara a conta funcional `cdout.1gav11@gmail.com` para envio futuro pela Gmail API. Esta etapa nao envia e-mail.

## Variaveis server-side

Configure somente em `.env.local`, que ja e ignorado pelo Git:

```text
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_SENDER_EMAIL=cdout.1gav11@gmail.com
GMAIL_SENDER_NAME=CDOUT - 1/11 GAV
AVOP_EMAIL_MODE=dry-run
CRON_SECRET=
```

Nunca use `NEXT_PUBLIC_` para variaveis Gmail. Nunca envie esses valores por chat, e-mail, issue, print de tela ou commit.

## Google Cloud

1. Crie ou selecione um projeto Google Cloud exclusivo para a Central V2.
2. Habilite a Gmail API no projeto.
3. Configure a OAuth consent screen.
4. Para conta `@gmail.com`, use app externo.
5. Enquanto o app estiver em Testing, adicione `cdout.1gav11@gmail.com` como test user.
6. Solicite somente o escopo `https://www.googleapis.com/auth/gmail.send`.
7. Crie um OAuth Client do tipo Web application.
8. Adicione o redirect URI local: `http://localhost:3456/oauth2callback`.
9. Copie `GMAIL_CLIENT_ID` e `GMAIL_CLIENT_SECRET` para `.env.local`.

## Refresh token

Valide primeiro sem iniciar consentimento:

```powershell
npm run gmail:oauth:check
```

Depois inicie o fluxo local:

```powershell
npm run gmail:oauth:local
```

O script:

- falha se `APP_ENV` ou `NODE_ENV` estiver em `production`;
- falha se `AVOP_EMAIL_MODE=gmail`;
- usa `access_type=offline`;
- usa somente o escopo `gmail.send`;
- usa `prompt=consent`;
- valida `state`;
- aceita callback apenas em `localhost`;
- nao envia e-mail;
- nao acessa Supabase ou Drive;
- nao imprime client secret, authorization code, access token nem refresh token;
- salva apenas `GMAIL_REFRESH_TOKEN` em `.env.local`.

Se o Google nao retornar refresh token, revogue o consentimento anterior do app na conta funcional e repita o fluxo com `prompt=consent`.

## Testing e Production

Segundo a documentacao oficial do Google, apps OAuth em Testing com escopos fora de nome/e-mail/perfil ficam limitados a test users, e a autorizacao expira em 7 dias. Se o app pedir `offline` access, o refresh token tambem expira nesse modo.

Para uso duradouro, coloque o app em Production apos revisar consent screen, dominio, justificativa do escopo `gmail.send` e requisitos de verificacao aplicaveis. `gmail.send` e escopo sensivel; use apenas esse escopo minimo.

## Validacao antes de envio real

Antes de ativar `AVOP_EMAIL_MODE=gmail`:

1. Confirme que `.env.local` nao aparece no `git status`.
2. Confirme que nenhum segredo entrou em `package.json`, docs, testes ou migration.
3. Execute `npm run gmail:oauth:check`.
4. Execute `npm run lint`, `npm test -- --reporter=verbose`, `npm run typecheck`, `npm run build` e `npm audit --offline=false`.
5. Mantenha `AVOP_EMAIL_MODE=dry-run` ate a etapa explicitamente autorizada de envio real.

## Envio real unico controlado

Depois que `npm run gmail:oauth:check` indicar todas as variaveis como presentes, existe um teste manual de entrega real com travas adicionais:

```powershell
$env:GMAIL_TEST_RECIPIENT = "cdout.1gav11@gmail.com"
$env:CONFIRM_GMAIL_TEST_SEND = "SEND_ONE_EMAIL"
npm run gmail:test:send
```

Regras do teste:

- funciona somente com `APP_ENV=development`;
- exige `AVOP_EMAIL_MODE=dry-run`;
- exige `GMAIL_TEST_RECIPIENT`;
- nesta primeira versao, `GMAIL_TEST_RECIPIENT` precisa ser exatamente igual a `GMAIL_SENDER_EMAIL`;
- exige `CONFIRM_GMAIL_TEST_SEND=SEND_ONE_EMAIL`;
- envia exatamente uma mensagem ficticia;
- nao executa cron;
- nao acessa Supabase;
- nao acessa Google Drive;
- nao consulta `notification_schedule`;
- nao imprime client secret, refresh token, access token ou resposta bruta da Gmail API;
- retorna somente sucesso com identificador local do teste, ou erro sanitizado.

Use esse teste apenas para validar que a conta funcional autorizada consegue enviar. Ele nao homologa a engine de notificacoes, nao registra envio no banco e nao deve ser usado para cobrancas reais.

## Pendencias antes de producao

- Criar migration futura para indice de apoio em `notification_log.profile_id`, apontado pelo Performance Advisor apos a homologacao da engine.
- Definir rotina operacional de rotacao do `GMAIL_REFRESH_TOKEN`.
- Confirmar o estado Production do app OAuth para evitar expiracao semanal do refresh token.
