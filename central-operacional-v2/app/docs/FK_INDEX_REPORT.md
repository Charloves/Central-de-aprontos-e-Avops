# Relatorio de FKs sem indice de apoio

Este relatorio registra os achados de performance apos a aplicacao das migrations `0001` a `0004` no projeto Supabase de desenvolvimento. A migration `0005_security_hardening` trata apenas endurecimento de seguranca. Indices de apoio para foreign keys devem ser tratados em migration posterior.

Regra desta etapa: nao remover indices apenas porque ainda nao foram usados pelo advisor. Indices `unused_index` precisam de observacao em homologacao com carga real antes de qualquer remocao.

## Indices recomendados

| Tabela | FK / coluna | Indice recomendado | Justificativa | Observacao sobre redundancia |
| --- | --- | --- | --- | --- |
| `profile_roles` | `assigned_by` | `profile_roles_assigned_by_idx` on `(assigned_by)` | Apoia auditoria e deletes/updates em `profiles.id`. | PK/unique de `profile_roles` cobre `profile_id`, nao `assigned_by`. |
| `profile_audiences` | `audience_id` | `profile_audiences_audience_id_idx` on `(audience_id)` | Apoia consultas por publico e integridade referencial em `audiences`. | PK cobre `(profile_id, audience_id)`, nao buscas iniciadas por `audience_id`. |
| `avops` | `closed_by` | `avops_closed_by_idx` on `(closed_by)` | Apoia auditoria de fechamento por perfil. | Indice atual de AVOP e por status/data, nao por fechador. |
| `avop_audiences` | `audience_id` | `avop_audiences_audience_id_idx` on `(audience_id)` | Apoia filtros de AVOP por publico. | PK cobre `(avop_id, audience_id)`, nao buscas iniciadas por `audience_id`. |
| `avop_acknowledgements` | `profile_id` | `avop_acknowledgements_profile_id_idx` on `(profile_id)` | Apoia auditoria por militar e integridade em `profiles`. | Unique `(avop_id, profile_id)` cobre AVOP primeiro, nao perfil primeiro. |
| `briefing_audiences` | `audience_id` | `briefing_audiences_audience_id_idx` on `(audience_id)` | Apoia consultas de aprontos por publico. | PK cobre `(briefing_id, audience_id)`, nao buscas iniciadas por `audience_id`. |
| `briefing_records` | `profile_id` | `briefing_records_profile_id_idx` on `(profile_id)` | Apoia auditoria de presenca por militar. | Unique `(briefing_id, profile_id)` cobre apronto primeiro. |
| `absence_justifications` | `briefing_id` | `absence_justifications_briefing_id_idx` on `(briefing_id)` | Apoia listagem de justificativas por apronto. | Nao ha indice atual nessa tabela. |
| `absence_justifications` | `profile_id` | `absence_justifications_profile_id_idx` on `(profile_id)` | Apoia auditoria de justificativas por militar. | Nao ha indice atual nessa tabela. |
| `notification_schedule` | `profile_id` | `notification_schedule_profile_id_idx` on `(profile_id)` | Apoia cobrancas por militar. | Unique `(activity_type, activity_id, profile_id)` nao cobre buscas iniciadas por perfil. |
| `notification_log` | `schedule_id` | `notification_log_schedule_id_idx` on `(schedule_id)` | Apoia historico de envios por agendamento. | Nao ha indice atual por `schedule_id`. |
| `audit_log` | `actor_profile_id` | `audit_log_actor_profile_id_idx` on `(actor_profile_id)` | Apoia auditoria por ator. | Nao ha indice atual por ator. |
| `profile_audience_history` | `audience_id` | `profile_audience_history_audience_id_idx` on `(audience_id)` | Apoia integridade referencial e consultas pelo publico normalizado. | Existe indice por `audience_code_snapshot`, mas ele nao cobre a FK `audience_id`. |
| `profile_audience_history` | `created_by` | `profile_audience_history_created_by_idx` on `(created_by)` | Apoia auditoria de quem criou evidencias historicas. | Indices atuais cobrem periodo, publico snapshot e flags de migracao. |
| `avop_publication_snapshots` | `created_by` | `avop_publication_snapshots_created_by_idx` on `(created_by)` | Apoia auditoria de publicacao. | Unique por `avop_id` nao cobre criador. |
| `avop_publication_snapshot_members` | `audience_id` | `avop_publication_snapshot_members_audience_id_fk_idx` on `(audience_id)` | Apoia FK contra `audiences`. | Existe indice por `audience_code_snapshot`, nao por `audience_id`. |
| `briefing_publication_snapshots` | `created_by` | `briefing_publication_snapshots_created_by_idx` on `(created_by)` | Apoia auditoria de abertura/publicacao. | Unique por `briefing_id` nao cobre criador. |
| `briefing_publication_snapshot_members` | `audience_id` | `briefing_publication_snapshot_members_audience_id_fk_idx` on `(audience_id)` | Apoia FK contra `audiences`. | Existe indice por `audience_code_snapshot`, nao por `audience_id`. |
| `historical_import_batches` | `created_by` | `historical_import_batches_created_by_idx` on `(created_by)` | Apoia auditoria de lotes por coordenador/admin. | Indices atuais cobrem status e origem. |
| `historical_import_staging_records` | `created_by` | `historical_import_staging_records_created_by_idx` on `(created_by)` | Apoia auditoria de criacao do staging. | Indices atuais cobrem lote, classificacao, resolucao e idempotencia. |
| `historical_import_staging_records` | `resolved_by` | `historical_import_staging_records_resolved_by_idx` on `(resolved_by)` | Apoia auditoria de resolucao futura. | Indice atual de resolucao cobre entidade resolvida, nao responsavel pela resolucao. |
| `auth_audit_events` | `session_id` | `auth_audit_events_session_id_idx` on `(session_id)` | Apoia investigacao de eventos por sessao preservando auditoria com FK `ON DELETE SET NULL`. | Indices atuais cobrem tipo/data, perfil/data e fingerprints/data. |

## Proxima etapa sugerida

Criar uma migration dedicada, por exemplo `fk_support_indexes`, contendo apenas indices de apoio para as FKs acima. Antes de aplicar, validar em banco isolado se algum indice composto existente ja cobre o padrao real de consulta com a coluna FK como prefixo.
