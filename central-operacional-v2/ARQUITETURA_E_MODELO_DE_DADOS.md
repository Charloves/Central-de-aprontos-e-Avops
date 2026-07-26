# Arquitetura e modelo de dados

## Arquitetura lógica

```text
Navegador
  -> Aplicação Next.js
      -> API do servidor
          -> PostgreSQL/Supabase
          -> Gmail API
          -> Google Drive por links existentes
      -> Cookie de sessão assinado
```

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

### `notification_schedule`

- `id`
- `activity_type`
- `activity_id`
- `profile_id`
- `last_sent_at`
- `next_send_at`
- `send_count`
- `status`
- restrição única por atividade e perfil

### `notification_log`

- `id`
- `schedule_id`
- `recipient`
- `notification_type`
- `attempted_at`
- `result`
- `provider_message_id`
- `error`

### `audit_log`

- `id`
- `actor_profile_id`
- `action`
- `entity_type`
- `entity_id`
- `occurred_at`
- `metadata`

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
