# Operação de notificações, monitoramento e backup

## Estado seguro inicial

O ambiente de produção deve permanecer inicialmente com:

```text
AVOP_EMAIL_MODE=dry-run
GMAIL_DELIVERY_CONFIRMATION=
```

As credenciais OAuth podem ser configuradas antecipadamente no escopo `Production` da Vercel, mas isso não libera envio. A aplicação exige simultaneamente:

```text
AVOP_EMAIL_MODE=gmail
GMAIL_DELIVERY_CONFIRMATION=ENABLE_REAL_GMAIL_DELIVERY
```

Qualquer combinação diferente falha antes de consultar candidatos ou reservar notificações. `GMAIL_DELIVERY_CONFIRMATION` é server-only e nunca pode usar prefixo `NEXT_PUBLIC_`.

## Checklist de configuração Gmail

Configure somente no ambiente `Production` da Vercel:

- `GMAIL_CLIENT_ID`;
- `GMAIL_CLIENT_SECRET`;
- `GMAIL_REFRESH_TOKEN`;
- `GMAIL_SENDER_EMAIL`;
- `GMAIL_SENDER_NAME`.

Use a conta funcional autorizada, o escopo mínimo `https://www.googleapis.com/auth/gmail.send` e OAuth com acesso offline. Não use Gmail pessoal, senha de aplicativo ou credenciais no Git. O refresh token deve ser exclusivo do cliente OAuth de produção e armazenado como segredo.

Antes da ativação:

1. Manter `AVOP_EMAIL_MODE=dry-run` e `GMAIL_DELIVERY_CONFIRMATION` vazio.
2. Executar `production:check` usando variáveis injetadas pela Vercel, sem `env pull` de produção.
3. Aplicar e validar a migration `20260929143804_harden_avop_notification_operations.sql`.
4. Executar o cron uma vez em `dry-run` e consultar `/api/health/notifications` com `Authorization: Bearer <CRON_SECRET>`.
5. Confirmar zero reservas expiradas e zero erros permanentes.
6. Validar uma mensagem controlada para a própria conta funcional pelo fluxo `gmail:test:send`, fora do cron.
7. Alterar os dois gates de envio na Vercel e criar um novo deployment.
8. Acompanhar o primeiro job real e retornar imediatamente a `dry-run` em caso de divergência.

Mudanças em variáveis da Vercel só entram em vigor em um novo deployment. Não promova deployment antigo depois de alterar os gates.

## Cobranças

O cron permanece em `0 11 * * *`, sempre em UTC. No plano Hobby, a Vercel pode executar o job em qualquer instante entre 11:00 e 11:59 UTC, correspondente a 08:00–08:59 em `America/Sao_Paulo` no UTC-3. A regra de marcos usa datas, portanto essa variação dentro da hora não duplica cobrança.

Regras preservadas:

- divulgação inicial;
- cobranças nos dias 7, 14, 21 e 28;
- cobranças mensais a partir do segundo mês, com ajuste para o último dia de meses menores;
- encerramento em 365 dias;
- interrupção por ciência, AVOP fechado, perfil inativo, saída do público ou erro permanente;
- reserva transacional e chave idempotente por destinatário, AVOP, marco e resultado;
- `DRY_RUN` não consome o marco real, não incrementa `send_count` e não atualiza `last_sent_at`.

### Digest por destinatário

O processamento agrupa todas as pendências do ciclo por perfil e endereço de e-mail. Cada militar recebe, no máximo, uma mensagem por execução, contendo a lista dos AVOPs pendentes e o link individual para leitura e ciência. Dois militares diferentes continuam recebendo mensagens separadas.

As RPCs `reserve_avop_notification_digest` e `record_avop_notification_digest_result` operam o conjunto de itens de forma atômica. A reserva é tudo-ou-nada por perfil; a finalização grava um log por AVOP/marco na mesma transação. Repetições e execuções concorrentes não dividem o mesmo digest nem consomem parcialmente os marcos. O `provider_message_id` pode aparecer em mais de uma linha porque todas representam itens da mesma mensagem consolidada.

O limite defensivo é de 100 AVOPs por digest. Conteúdo operacional com CR, LF, NUL ou controles é rejeitado antes do Gmail. O corpo permanece texto simples UTF-8 e abrir um link não registra ciência.

Existe um risco residual inerente à integração externa: se a Gmail API aceitar a mensagem e a confirmação transacional no banco falhar antes do commit, uma tentativa posterior pode reenviar o digest. Por isso, a ativação real exige monitoramento do primeiro ciclo e retorno imediato para `dry-run` diante de falha de persistência.

## Monitoramento

O endpoint `GET /api/health/notifications` exige o mesmo `CRON_SECRET` do cron e retorna apenas métricas agregadas:

- agendamentos ativos e encerrados;
- reservas ativas e expiradas;
- envios, simulações e erros nas últimas 24 horas;
- horários da última tentativa e do último envio real.

Ele nunca retorna destinatários, perfis, trigramas, conteúdo, tokens ou chaves. O status HTTP é:

- `200`: saudável ou com aviso de erro temporário;
- `503`: reserva expirada, erro permanente ou falha de consulta;
- `403`: autenticação ausente ou inválida.

O cron grava logs estruturados com evento, modo, duração e contagens. Não registra destinatário, título, corpo, provider message ID ou detalhe bruto da Gmail API.

Rotina recomendada:

- diariamente: verificar o último job em **Vercel > Cron Jobs > View Logs**;
- diariamente após a janela do cron: consultar o endpoint de saúde;
- semanalmente: revisar `PERMANENT_ERROR`, perfis sem e-mail e agendamentos encerrados;
- mensalmente: revisar validade do OAuth, rotação planejada de segredos e volume de envios;
- após cada deploy: aguardar o estado `READY` e verificar logs de erro da primeira hora.

## Backup e restauração

Backups da plataforma dependem do plano do Supabase. Para manter uma cópia lógica independente, executar semanalmente a rotina oficial `supabase db dump` em terminal controlado, usando uma conexão de production fornecida manualmente e nunca salva no repositório:

```text
supabase db dump --db-url <CONNECTION_STRING> -f roles.sql --role-only
supabase db dump --db-url <CONNECTION_STRING> -f schema.sql
supabase db dump --db-url <CONNECTION_STRING> -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

Controles obrigatórios:

1. Diretório fora do repositório e protegido pelo sistema operacional.
2. Criptografia antes de copiar para armazenamento externo controlado.
3. SHA-256 de cada arquivo e manifesto com data, ambiente e versões, sem credenciais.
4. Retenção sugerida: quatro cópias semanais e doze mensais, sujeita à política organizacional.
5. Teste mensal de restauração em banco isolado e descartável, nunca sobre production ou development.
6. Registro do resultado do teste, das contagens sanitizadas e do responsável.
7. Inclusão separada de objetos do Supabase Storage, caso sejam usados no futuro; o backup do banco não inclui arquivos do Storage.

O envio automático de backups ao Google Drive não faz parte deste lote. Ele exige conta funcional, escopo próprio, criptografia e autorização separada.

## Retorno seguro

Em caso de envio indevido ou erro:

1. Definir `AVOP_EMAIL_MODE=dry-run`.
2. Remover `GMAIL_DELIVERY_CONFIRMATION`.
3. Criar novo deployment de produção.
4. Desabilitar temporariamente o Cron Job no painel da Vercel se houver risco imediato.
5. Consultar logs e saúde sem apagar `notification_log`.
6. Não editar contadores ou histórico manualmente; qualquer correção deve ser migration revisada.

Referências oficiais:

- https://developers.google.com/workspace/gmail/api/auth/web-server
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://vercel.com/docs/cron-jobs/manage-cron-jobs
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
