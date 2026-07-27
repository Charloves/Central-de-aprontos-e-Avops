# Implementação da Central Operacional V2

## Objetivo desta base

Esta implementação inicial cria a fundação técnica da V2 sem alterar a Central atual, a planilha oficial ou os PDFs no Drive.

## Ordem recomendada de evolução

1. Criar projeto Supabase de desenvolvimento.
2. Aplicar `supabase/migrations/0001_initial_schema.sql`.
3. Configurar `.env.development.local` a partir de `.env.example`.
4. Importar uma cópia sanitizada das abas da planilha oficial.
5. Comparar contagens da importação com a planilha.
6. Implementar telas conectadas ao banco por módulo: autenticação, AVOP, Apronto, OI, dashboard e administração.
7. Criar ambiente de homologação com banco separado.
8. Publicar somente após conferência e aprovação formal.

## Regras já codificadas

- Normalização de trigrama.
- Normalização de formatos legados de AVOP.
- Perfis mistos e aliases de público-alvo.
- Busca OI por missão completa, fase e código parcial.
- Cobrança semanal de AVOP nos primeiros 30 dias.
- Cobrança mensal após 30 dias.
- Encerramento da cobrança por ciência, fechamento, inativação, saída do público-alvo ou 365 dias.
- `CHA` como coordenador/admin inicial.
- Transferência futura de coordenação por função auditável.

## Pontos ainda não conectados

- Consulta real ao Supabase nas páginas.
- Server actions/API routes de login e sessão por cookie.
- Importação automatizada diretamente da planilha.
- Envio real de e-mail por job agendado.
- Fechamento automático de aprontos.
- Backup externo para Google Drive.

## Segurança

Nenhum segredo deve ser commitado. Use somente arquivos `.env.*.local` para credenciais reais.

## Migration 0002

`supabase/migrations/0002_publication_history_snapshots.sql` acrescenta a estrutura de histórico de público/perfil e snapshots nominais de publicação.

Essa migration deve ser aplicada após `0001_initial_schema.sql`. Ela não importa dados, não recalcula histórico antigo e não altera registros legados. O objetivo é preservar, a partir da V2, o denominador nominal de cada AVOP e apronto no momento da publicação ou abertura.

Quando a origem for migração e não houver evidência confiável do perfil vigente na época, os registros devem manter a limitação em `limitation_reason`, usando `perfil historico nao disponivel`.

## Importacao em dry-run

`npm run import:dry-run` executa os importadores locais iniciais para `EFETIVO`, `AVOPS`, `LEITURAS`, `APRONTOS`, `PRESENCAS`, `OI_H50` e `OI_H125` usando fixtures ficticias. A rotina nao acessa a planilha oficial, nao usa Apps Script, nao acessa Google Drive e nao grava no Supabase.

Use `npm run import:dry-run -- --redact` quando o relatorio precisar ser compartilhado sem expor nome, e-mail, justificativas, chaves operacionais derivadas de dados pessoais ou textos operacionais de OI. O formato esperado dos arquivos esta documentado em `docs/IMPORTACAO_DRY_RUN.md`.

## Consulta OI pura

As regras puras de consulta de OI funcionam sobre metadados ja importados em memoria, sem interface e sem banco real.

Regras implementadas:

- filtrar por aeronave quando o filtro for informado;
- buscar por codigo completo de missao, como `01HE01D07`;
- aplicar fallback para codigo-base/fase, como `01HE01`, somente quando a linha possui fase compativel;
- quando a linha tem lista explicita de missoes, um codigo completo fora dessa lista nao e aceito por fallback amplo;
- pesquisar por fase, titulo, programa, subprograma e prefixo parcial;
- retornar `single`, `ambiguous`, `not_found` ou `empty`;
- nunca escolher silenciosamente quando houver mais de uma correspondencia;
- ordenar resultados de forma deterministica por `score`, `aircraft`, `oiKey`, `startPage` e `driveFileId`;
- ignorar OIs inativas nas consultas operacionais comuns;
- preservar o link original do Google Drive no registro retornado;
- abertura do documento nao equivale a ciencia.

## Staging historico

`supabase/migrations/0003_historical_import_staging.sql` cria uma estrutura generica para lotes de importacao e registros historicos em staging.

Linhas ambiguas de `PRESENCAS`, como registros sem status, justificativa ou ciencia de material, nao sao preparadas para `briefing_records`, pois `briefing_records.attendance_status` permanece `NOT NULL`. Nesses casos o dry-run gera uma operacao `stage`, preservando o conteudo original, o conteudo normalizado parcial, os warnings e a razao da limitacao.

A identidade do lote usa `source_file_hash`, obrigatorio, calculado futuramente pelo importador como SHA-256 dos bytes exatos do arquivo de origem. A migration usa indice unico com `coalesce(source_reference, '')` para impedir lote duplicado mesmo quando nao houver referencia externa.

A resolucao futura deve ser feita por coordenador/admin: o registro definitivo pode ser criado ou vinculado e, depois disso, o staging recebe `resolved_entity_type`, `resolved_entity_id`, `resolved_by`, `resolved_at` e `resolution_notes`. O JSON original nao deve ser apagado nem alterado. O banco bloqueia update de `original_content` por trigger.

## Logs legados

Os importadores locais tambem aceitam `EMAIL_LOG` e `ACESSOS_LOG` em CSV ou JSON, sem acessar Gmail, Google Sheets ou Supabase.

`EMAIL_LOG` e preparado para futura escrita em `notification_log` quando houver destinatario. O registro preserva `AVOP_ID`, trigrama, tipo original, resultado original, mensagem de erro e observacao em payload/metadados futuros. Linhas de job ou linhas sem destinatario seguem para staging, pois `notification_log.recipient` nao deve receber valor inventado.

`ACESSOS_LOG` e preparado para futura escrita em `audit_log`, mantendo trigrama normalizado apenas como evidencia legada ate que o perfil seja resolvido no banco. Login valido, login negado e acesso administrativo sao classificados somente quando houver evidencia nos campos `MODULO`, `ACAO`, `STATUS` e `DETALHE`.

As idempotency keys dos novos logs usam SHA-256 dos campos normalizados para reduzir exposicao direta de e-mail, trigrama, IP e user-agent. Operacoes de staging tambem usam SHA-256 de conteudo canonico, sem incluir `rowNumber` na identidade. O `rowNumber` fica apenas como metadado de auditoria para localizar a linha original. Quando houver ocorrencias exatamente identicas do mesmo fingerprint, o importador adiciona ordinal deterministico por ocorrencia, preservando todas as linhas sem depender da ordem fisica do arquivo. O modo `--redact` sanitiza payload, original, staging, issues e oculta `idempotencyKey` em relatorios compartilhaveis.
