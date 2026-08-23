# Relatório de índices de apoio para FKs

Este relatório registra a conferência das foreign keys após a aplicação das migrations `0001` a `0006` no projeto Supabase de desenvolvimento.

A validação usou duas fontes:

- Performance Advisor: no momento da revisão final, retornou `No issues found`.
- Catálogo PostgreSQL: confirmou 22 FKs no schema `public` sem índice cujo prefixo inicial cubra integralmente as colunas da FK.

Regra aplicada: uma FK é considerada coberta quando existe índice, PK ou unique constraint na tabela referenciadora com as colunas da FK como prefixo inicial e na mesma ordem. Índices compostos que têm a FK fora do prefixo inicial não cobrem a FK para esta finalidade.

Índices `unused_index` permanecem intactos. Eles só devem ser avaliados para remoção após carga real, homologação e evidência de workload.

## Índices criados pela 0007

| Tabela | FK / coluna | Índice | Justificativa | Observação sobre redundância |
| --- | --- | --- | --- | --- |
| `absence_justifications` | `briefing_id` | `absence_justifications_briefing_id_idx` | Apoia listagem e integridade de justificativas por apronto. | Não havia índice cobrindo `briefing_id`. |
| `absence_justifications` | `profile_id` | `absence_justifications_profile_id_idx` | Apoia auditoria de justificativas por militar. | Não havia índice cobrindo `profile_id`. |
| `audit_log` | `actor_profile_id` | `audit_log_actor_profile_id_idx` | Apoia auditoria por ator. | Não havia índice cobrindo `actor_profile_id`. |
| `auth_audit_events` | `session_id` | `auth_audit_events_session_id_idx` | Apoia investigação de eventos por sessão preservando FK `ON DELETE SET NULL`. | Índices existentes cobrem perfil/data e fingerprints/data, não `session_id`. |
| `avop_acknowledgements` | `profile_id` | `avop_acknowledgements_profile_id_idx` | Apoia auditoria de ciências por militar. | Unique `(avop_id, profile_id)` cobre AVOP primeiro, não perfil primeiro. |
| `avop_audiences` | `audience_id` | `avop_audiences_audience_id_idx` | Apoia filtros de AVOP por público. | PK cobre `(avop_id, audience_id)`, não buscas iniciadas por `audience_id`. |
| `avop_publication_snapshot_members` | `audience_id` | `avop_publication_snapshot_members_audience_id_idx` | Apoia FK contra `audiences`. | Índices existentes cobrem AVOP, perfil, snapshot e código snapshot, não `audience_id`. |
| `avop_publication_snapshots` | `created_by` | `avop_publication_snapshots_created_by_idx` | Apoia auditoria de publicação por perfil. | Unique por `avop_id` não cobre criador. |
| `avops` | `closed_by` | `avops_closed_by_idx` | Apoia auditoria de encerramento por perfil. | Índices atuais cobrem identificadores/status, não fechador. |
| `briefing_audiences` | `audience_id` | `briefing_audiences_audience_id_idx` | Apoia consultas de aprontos por público. | PK cobre `(briefing_id, audience_id)`, não buscas iniciadas por `audience_id`. |
| `briefing_publication_snapshot_members` | `audience_id` | `briefing_publication_snapshot_members_audience_id_idx` | Apoia FK contra `audiences`. | Índices existentes cobrem briefing, perfil, snapshot e código snapshot, não `audience_id`. |
| `briefing_publication_snapshots` | `created_by` | `briefing_publication_snapshots_created_by_idx` | Apoia auditoria de abertura/publicação. | Unique por `briefing_id` não cobre criador. |
| `briefing_records` | `profile_id` | `briefing_records_profile_id_idx` | Apoia auditoria de presença por militar. | Unique `(briefing_id, profile_id)` cobre apronto primeiro. |
| `historical_import_batches` | `created_by` | `historical_import_batches_created_by_idx` | Apoia auditoria de lotes por coordenador/admin. | Índices atuais cobrem status e origem. |
| `historical_import_staging_records` | `created_by` | `historical_import_staging_records_created_by_idx` | Apoia auditoria de criação do staging. | Índices atuais cobrem lote, classificação, resolução e idempotência. |
| `historical_import_staging_records` | `resolved_by` | `historical_import_staging_records_resolved_by_idx` | Apoia auditoria de resolução futura. | Índice atual de resolução cobre entidade resolvida, não responsável pela resolução. |
| `notification_log` | `schedule_id` | `notification_log_schedule_id_idx` | Apoia histórico de envios por agendamento. | Não havia índice cobrindo `schedule_id`. |
| `notification_schedule` | `profile_id` | `notification_schedule_profile_id_idx` | Apoia cobranças por militar. | Unique `(activity_type, activity_id, profile_id)` não cobre buscas iniciadas por perfil. |
| `profile_audience_history` | `audience_id` | `profile_audience_history_audience_id_idx` | Apoia integridade referencial e consultas por público normalizado. | Índice por `audience_code_snapshot` não cobre a FK `audience_id`. |
| `profile_audience_history` | `created_by` | `profile_audience_history_created_by_idx` | Apoia auditoria de quem criou evidências históricas. | Índices atuais cobrem período, público snapshot e flags de migração. |
| `profile_audiences` | `audience_id` | `profile_audiences_audience_id_idx` | Apoia integridade e consultas por público ativo. | PK cobre `(profile_id, audience_id)`, não buscas iniciadas por `audience_id`. |
| `profile_roles` | `assigned_by` | `profile_roles_assigned_by_idx` | Apoia auditoria de atribuição de papéis por perfil. | PK cobre `(profile_id, role)`, não `assigned_by`. |

## FKs excluídas

Nenhuma FK da lista confirmada foi excluída. As demais FKs do schema `public` já estavam cobertas por PK, unique constraint ou índice cujo prefixo inicial corresponde às colunas da FK.

## Estratégia

`supabase/migrations/0007_add_foreign_key_indexes.sql` cria somente índices B-tree comuns no lado referenciador das FKs confirmadas. A migration usa `CREATE INDEX IF NOT EXISTS`, qualifica tabelas com `public`, não usa `CONCURRENTLY` e não altera RLS, policies, grants, funções, constraints, dados, índices existentes ou schemas internos do Supabase.

## Complemento para `notification_log.profile_id`

Após a homologação da engine de notificações de AVOP, o Performance Advisor passou a apontar a FK `notification_log_profile_id_fkey` como sem índice de apoio. O catálogo PostgreSQL confirmou que `notification_log.profile_id` existe como FK e que os índices existentes em `notification_log` não têm `profile_id` como prefixo inicial:

- `notification_log_activity_marker_idx` cobre `(activity_type, activity_id, profile_id, marker, result)`, portanto não atende consultas ou verificações iniciadas por `profile_id`;
- `notification_log_schedule_id_idx` cobre apenas `schedule_id`;
- a PK e o índice de idempotência cobrem `id` e `idempotency_key`.

`supabase/migrations/20260823000237_add_notification_log_profile_id_index.sql` corrige exclusivamente esse achado com um índice B-tree comum:

```sql
create index if not exists notification_log_profile_id_idx
  on public.notification_log using btree (profile_id);
```

A migration não usa `CONCURRENTLY`, não altera FK, tabela, dados, RLS, policies, grants, funções ou índices existentes.
