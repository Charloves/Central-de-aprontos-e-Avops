# Arquitetura e modelo de dados

## Arquitetura lógica

```text
Navegador
  -> Aplicação Next.js
      -> API do servidor
          -> PostgreSQL/Supabase
          -> Gmail API
          -> Google Drive por links existentes
      -> Cookie de sessão opaco
```

## Modelo de acesso ao banco

A V2 atual usa Supabase apenas pelo backend server-side. O navegador nao recebe acesso direto as tabelas, nao recebe lista de trigramas e nao usa `SUPABASE_SECRET_KEY`.

`SUPABASE_SECRET_KEY` e exclusiva do backend, deve usar a chave moderna `sb_secret_...`, nunca deve ser versionada e deve ser diferente em desenvolvimento, homologacao e producao.

Classificacao inicial das tabelas publicas:

- Backend/service_role exclusivo: `profiles`, `profile_roles`, `audiences`, `profile_audiences`, `avops`, `avop_audiences`, `avop_acknowledgements`, `briefings`, `briefing_audiences`, `briefing_records`, `absence_justifications`, `ois`, `notification_schedule`, `notification_log`, `audit_log`, `backup_index`, `settings`.
- Historico, auditoria ou staging server-only: `profile_audience_history`, `avop_publication_snapshots`, `avop_publication_snapshot_members`, `briefing_publication_snapshots`, `briefing_publication_snapshot_members`, `historical_import_batches`, `historical_import_staging_records`.
- Seguranca interna server-only: `auth_rate_limit_buckets`, `auth_temporary_blocks`, `auth_sessions`, `auth_audit_events`.
- Eventual acesso futuro pelo navegador: nenhum nesta fase.

`0005_security_hardening` habilita RLS em todas as tabelas do schema `public`, remove grants de `PUBLIC`, `anon` e `authenticated`, nao cria policies permissivas e preserva apenas o acesso necessario ao `service_role`. Qualquer acesso direto futuro pelo navegador deve ser modelado em migration propria, com policies especificas, testes de autorizacao e revisao de dados pessoais expostos.

A migration tambem remove `CREATE` no schema `public` para roles de navegador e ajusta default privileges para que novos objetos criados por migrations futuras nao herdem exposicao acidental. Isso e intencionalmente restritivo: o backend continua operando com `service_role`, e o navegador permanece sem rota direta ao banco.

## Princípio documental

Os arquivos não serão copiados para a aplicação. AVOPs, aprontos e OI permanecem no Google Drive compartilhado. A aplicação armazena apenas metadados e links.

## Entidades principais

### `profiles`

- `id`
- `trigram` — único e normalizado
- `name`
- `rank`
- `active`
- `role` — USER, COORDINATOR ou ADMIN
- `created_at`
- `updated_at`

### `audiences`

- `id`
- `code`
- `name`
- `active`

### `profile_audiences`

- `profile_id`
- `audience_id`
- vigência opcional

### `profile_audience_history`

- `id`
- `profile_id`
- `audience_id`
- `audience_code_snapshot`
- `audience_name_snapshot`
- `valid_from`
- `valid_to`
- `source`
- `source_reference`
- `migrated`
- `historical_profile_available`
- `limitation_reason`
- `metadata`
- `created_by`
- `created_at`
- `updated_at`

Usada quando houver evidência confiável do perfil vigente em determinado período. Quando não houver evidência, a migração deve preservar o registro original e marcar a limitação como `perfil histórico não disponível`, sem reconstruir retroativamente públicos, leituras, presenças ou denominadores.

### `avops`

- `id`
- `number`
- `title`
- `publication_date`
- `drive_url`
- `drive_file_id`
- `status` — DRAFT, PUBLISHED ou CLOSED
- `closed_at`
- `closed_by`
- `created_at`
- `updated_at`

### `avop_audiences`

- `avop_id`
- `audience_id`

### `avop_publication_snapshot`

- `avop_id`
- `published_at`
- `audience_snapshot`
- `applicable_profile_snapshot`
- `applicable_profile_count`
- `historical_limitations`
- `source_metadata`

A partir da V2, preserva o público aplicável e os perfis considerados no momento da publicação. Esse snapshot é a base para auditoria histórica futura, sem depender de alterações posteriores no efetivo.

### `avop_publication_snapshot_members`

- `snapshot_id`
- `avop_id`
- `profile_id`
- `audience_id`
- `trigram_snapshot`
- `name_snapshot`
- `email_snapshot`
- `audience_code_snapshot`
- `audience_name_snapshot`
- `profile_active_snapshot`
- `applicable_profile_source`
- `valid_from`
- `valid_to`
- `source`
- `source_reference`
- `migrated`
- `historical_profile_available`
- `limitation_reason`
- `metadata`

Tabela nominal do denominador do AVOP no momento da publicação. Ela preserva o vínculo entre militar, perfil/público aplicável e publicação, mesmo que o efetivo atual seja alterado depois.

### `avop_acknowledgements`

- `id`
- `avop_id`
- `profile_id`
- `acknowledged_at`
- `session_id`
- `request_metadata`
- restrição única: `avop_id + profile_id`

### `briefings`

- `id`
- `title`
- `event_date`
- `drive_url`
- `drive_file_id`
- `status` — DRAFT, OPEN, CLOSED
- `closed_at`
- `closure_type` — AUTOMATIC ou MANUAL

### `briefing_audiences`

- `briefing_id`
- `audience_id`

### `briefing_publication_snapshot`

- `briefing_id`
- `opened_at`
- `audience_snapshot`
- `applicable_profile_snapshot`
- `applicable_profile_count`
- `historical_limitations`
- `source_metadata`

A partir da V2, preserva o público aplicável e os perfis considerados no momento da abertura/publicação do apronto.

### `briefing_publication_snapshot_members`

- `snapshot_id`
- `briefing_id`
- `profile_id`
- `audience_id`
- `trigram_snapshot`
- `name_snapshot`
- `email_snapshot`
- `audience_code_snapshot`
- `audience_name_snapshot`
- `profile_active_snapshot`
- `applicable_profile_source`
- `valid_from`
- `valid_to`
- `source`
- `source_reference`
- `migrated`
- `historical_profile_available`
- `limitation_reason`
- `metadata`

Tabela nominal do denominador do apronto no momento da abertura/publicação. Ela deve ser usada para auditoria histórica de presença, falta e justificativa.

### `briefing_records`

- `id`
- `briefing_id`
- `profile_id`
- `attendance_status`
- `recorded_at`
- restrição única conforme regra atual

### `absence_justifications`

- `id`
- `briefing_id`
- `profile_id`
- `text`
- `created_at`
- `updated_at`
- histórico de versões ou tabela de eventos

### `ois`

- `id`
- `aircraft`
- `oi_key`
- `program`
- `subprogram`
- `phase_id`
- `title`
- `drive_url`
- `drive_file_id`
- `start_page`
- `end_page`
- `display_key`
- `active`

As abas legadas `OI_H50` e `OI_H125` mapeiam diretamente para esta tabela. O importador deve preservar `OI_KEY`, `CHAVE_EXIBICAO`, `PDF_URL`, `PDF_FASE_URL` e a lista de `MISSOES` sem acessar Google Drive. Registros sem link, com missoes incompativeis com a fase ou com colisao de chave devem ser preservados no staging historico, nao gravados silenciosamente em `ois`.

### `notification_schedule`

- `id`
- `activity_type`
- `activity_id`
- `profile_id`
- `notification_type`
- `marker`
- `last_sent_at`
- `next_send_at`
- `send_count`
- `attempt_count`
- `failed_attempt_count`
- `reserved_at`
- `reserved_until`
- `reservation_token_hash`
- `permanent_failure_at`
- `stopped_at`
- `stopped_reason`
- `metadata`
- `status`
- restrição única por atividade e perfil

A programação de AVOP usa reserva transacional por hash de token e registro idempotente por marco. O navegador não acessa essas tabelas; o job roda no backend com `service_role`.

### `notification_log`

- `id`
- `schedule_id`
- `activity_type`
- `activity_id`
- `profile_id`
- `recipient`
- `notification_type`
- `marker`
- `attempted_at`
- `result`
- `provider_message_id`
- `error`
- `error_kind`
- `idempotency_key`
- `attempt_number`
- `reserved_at`

O log não deve armazenar corpo completo de e-mail, tokens OAuth, refresh token, segredo de cron ou credenciais. Registros de falha usam mensagem controlada.

### `audit_log`

- `id`
- `actor_profile_id`
- `action`
- `entity_type`
- `entity_id`
- `occurred_at`
- `metadata`

### `auth_rate_limit_buckets`

- `id`
- `scope` - TRIGRAM, NETWORK ou COMBINED
- `trigram_fingerprint`
- `network_fingerprint`
- `trigram_key` - coluna gerada nao nula para unicidade
- `network_key` - coluna gerada nao nula para unicidade
- `window_started_at`
- `window_ends_at`
- `failure_count`
- `success_count`
- `last_attempt_at`
- `created_at`
- `updated_at`

Tabela server-only para contagem persistente de tentativas de login. Fingerprints devem ser HMAC-SHA256 com segredo server-side; nao armazenar trigrama, IP ou user-agent em claro. A unicidade usa constraints comuns sobre colunas geradas, evitando dependencia de `ON CONFLICT` contra indices de expressao.

### `auth_temporary_blocks`

- `id`
- `scope`
- `trigram_fingerprint`
- `network_fingerprint`
- `trigram_key`
- `network_key`
- `active_marker`
- `reason`
- `failed_attempts`
- `window_started_at`
- `blocked_until`
- `lifted_at`
- `lifted_reason`
- `created_at`
- `updated_at`

Controla bloqueios temporarios apos falhas sucessivas. Cada ciclo de bloqueio e uma linha propria. Um bloqueio ativo usa `active_marker = ACTIVE`; ao ser encerrado, o marcador passa para o proprio `id`, preservando historico sem permitir bloqueio ativo duplicado para o mesmo escopo/fingerprint. Quando o bloqueio expira e ainda esta com `lifted_at` nulo, a RPC transacional marca `lifted_at` e `lifted_reason = EXPIRED` antes de inserir um novo ciclo, sem sobrescrever `window_started_at`, `blocked_until` ou `failed_attempts` do ciclo anterior.

### `auth_sessions`

- `id`
- `profile_id`
- `session_identifier_hash`
- `nonce_hash`
- `issued_at`
- `expires_at`
- `last_seen_at`
- `revoked_at`
- `revoked_reason`
- `network_fingerprint`
- `user_agent_fingerprint`
- `metadata`

Vincula cookies opacos a estado persistente revogavel. O cookie contem somente um identificador aleatorio; o banco armazena apenas HMACs em `session_identifier_hash` e `nonce_hash`. Token bruto, trigrama, perfil, papeis e nonce bruto nao sao persistidos nem enviados como payload legivel. `metadata` permanece restrito a `{}` ate existir allowlist aprovada.

### `auth_audit_events`

- `id`
- `profile_id`
- `session_id`
- `event_type`
- `result`
- `trigram_fingerprint`
- `network_fingerprint`
- `reason`
- `occurred_at`
- `metadata`

Auditoria especifica de autenticacao sem dados pessoais em claro. Complementa `audit_log`, que permanece como auditoria geral do sistema. `metadata` permanece restrito a `{}` para evitar inclusao futura de valores brutos.

### `backup_index`

- `id`
- `created_at`
- `type`
- `drive_url`
- `checksum`
- `status`
- `notes`

### `settings`

- chave e valor para regras operacionais não secretas.
- segredos permanecem em variáveis do ambiente.

## Índices mínimos

- trigrama ativo;
- status e data de AVOP;
- status e data de apronto;
- próxima cobrança;
- público por perfil;
- ciência por AVOP e perfil;
- registros por apronto e perfil;
- código de OI e aeronave.

## Migração

Criar tabela de correspondência entre identificadores antigos e novos. Nunca depender apenas da posição da linha na planilha. Gerar relatório de contagem antes e depois por entidade e por usuário.

Regra de auditoria histórica:

- preservar integralmente registros históricos existentes;
- não alterar retroativamente públicos, leituras, presenças ou denominadores;
- quando não houver evidência do perfil vigente na época, registrar `perfil histórico não disponível`;
- tratar dashboards atuais baseados no efetivo atual como visão operacional, não como reconstrução histórica exata;
- usar snapshots de público e perfil aplicável para todo AVOP ou apronto publicado a partir da V2.
## Staging de importacao historica

### `historical_import_batches`

- `id`
- `source`
- `source_reference`
- `source_file_name`
- `source_file_hash`
- `record_type`
- `dry_run`
- `migrated`
- `status`
- `notes`
- `metadata`
- `created_by`
- `created_at`
- `updated_at`

Controla lotes de importacao historica. `source_file_hash` e obrigatorio e deve ser SHA-256 calculado sobre os bytes exatos do arquivo de origem antes do parse. A unicidade usa `source`, `coalesce(source_reference, '')` e `source_file_hash`, evitando duplicacao mesmo quando `source_reference` estiver vazio.

### `historical_import_staging_records`

- `id`
- `batch_id`
- `source`
- `source_record_type`
- `source_row_number`
- `idempotency_key`
- `original_content`
- `normalized_content`
- `classification` - valid, invalid, ambiguous, duplicate ou imported
- `issues`
- `limitation_reason`
- `migrated`
- `resolved_entity_type`
- `resolved_entity_id`
- `resolved_by`
- `resolved_at`
- `resolution_notes`
- `metadata`
- `created_by`
- `created_at`
- `updated_at`

Preserva linhas historicas que nao podem ser gravadas com seguranca em tabelas definitivas. Exemplo: presenca sem `STATUS`, sem justificativa e sem ciencia de material. Nesses casos, o importador nao inventa `attendance_status`; a linha vai para staging e pode ser resolvida posteriormente por coordenador, mantendo o JSON original intacto.

`original_content` e imutavel por trigger no banco. A resolucao futura deve alterar apenas classificacao, campos de resolucao, referencia definitiva, auditoria e metadados permitidos.

Regra adicional de auditoria historica:

- usar staging de importacao historica para linhas ambiguas, invalidas ou duplicadas que precisem ser preservadas sem alterar o significado do dado.

## Fluxo administrativo de importacao legada

A rota `/admin/importacao` centraliza o recebimento controlado de arquivos legados CSV ou JSON. Ela e restrita a `ADMIN`, com identidade derivada exclusivamente da sessao server-side, validacao de Origin/CSRF e uso de `SUPABASE_SECRET_KEY` apenas em modulos `server-only`.

Fases do fluxo:

- recebimento do arquivo com limite de tipo, extensao e tamanho;
- parse sem executar formulas, macros, comandos ou conteudo ativo;
- validacao contra referencias atuais de perfis, publicos, AVOPs, aprontos e OIs;
- classificacao entre validos, invalidos, duplicados, ambiguos e pendentes de decisao humana;
- preview sanitizado sem escrita operacional;
- confirmacao explicita vinculada a token opaco `HttpOnly` e hash server-side do arquivo validado;
- aplicacao transacional por RPC, com bloqueio do lote e auditoria nominal;
- relatorio final sanitizado para validos, rejeitados, duplicados e pendentes.

O preview pode gravar somente `historical_import_batches` e `historical_import_staging_records`. Tabelas operacionais so podem ser modificadas pela RPC `public.admin_apply_legacy_import_batch(uuid, uuid, text, timestamptz)`, que revalida administrador, status do lote, token de confirmacao e ausencia de inconsistencias bloqueantes dentro da mesma transacao.

Regras de preservacao:

- importacao nao cria nem concede `ADMIN`;
- importacao nao altera administrador existente;
- importacao nao cria sessoes, cookies, tokens ou credenciais;
- conteudo do arquivo e tratado como nao confiavel e amostras de relatorio sao sanitizadas;
- linhas ambiguas ou com referencias ausentes permanecem no staging para resolucao posterior;
- registros historicos existentes e snapshots ja publicados nao sao reconstruidos nem sobrescritos silenciosamente.
