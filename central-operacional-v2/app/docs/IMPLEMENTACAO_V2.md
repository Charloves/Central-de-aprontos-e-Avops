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

`SUPABASE_SECRET_KEY` é a chave secreta moderna da Supabase, no formato `sb_secret_...`, e é exclusiva do backend server-side. Ela não pode ser exposta como `NEXT_PUBLIC_*`, não pode ser registrada em logs, não deve aparecer em respostas HTTP e nunca deve ser versionada. Cada ambiente deve usar uma chave própria.

## Correção do primeiro fluxo funcional de autenticação

O primeiro teste funcional local identificou três ajustes necessários no caminho entre a interface Next.js e as RPCs persistentes de autenticação:

- A consulta de `profiles` com `profile_roles(role)` era ambígua no PostgREST porque `profile_roles` possui dois vínculos com `profiles`: `profile_id` e `assigned_by`. A V2 passou a usar a relação explícita `profile_roles!profile_roles_profile_id_fkey(role)` para carregar apenas os papéis do perfil autenticado.
- As chamadas server-side às RPCs de autenticação passaram a enviar `p_now` explicitamente. Isso evita que `undefined` chegue ao Supabase como parâmetro nulo e impede falhas em campos `timestamptz not null` que deveriam receber o horário corrente.
- A função `auth_finalize_login_failure`, criada na `0004`, preservava corretamente buckets, bloqueios e auditoria, mas o `CASE` usado para escolher entre `LOGIN_FAILURE` e `LOGIN_BLOCKED` era resolvido como `text` pelo PostgreSQL. A função `auth_record_audit_event` exige `auth_audit_event_type`, então a chamada falhava e a transação de falha era revertida. A migration `0008_fix_login_failure_audit_event_type.sql` substitui somente essa função e converte o `CASE` para `public.auth_audit_event_type`.

A migration `0008` não altera tabelas, dados, RLS, policies, índices, enums ou constraints. Ela preserva `SECURITY DEFINER`, `search_path = public, pg_temp`, locks transacionais, regra da quinta tentativa, bloqueio da sexta tentativa e grants mínimos para execução exclusiva pelo `service_role`.

## Modelo de acesso ao Supabase

A V2 não usa acesso direto do navegador ao Supabase. O navegador fala com a aplicação Next.js, e as operações de banco passam por rotas, server actions ou módulos server-side.

Consequências práticas:

- `SUPABASE_SECRET_KEY` deve existir apenas no servidor;
- Client Components não devem importar repositórios ou clientes com service role;
- `anon` e `authenticated` não recebem grants diretos nas tabelas da V2 nesta fase;
- todas as tabelas do schema `public` ficam com RLS habilitado;
- não existem policies permissivas genéricas para navegador;
- `profiles`, `audit_log`, staging histórico, sessões, registros de ciência, presenças e dados pessoais permanecem server-only;
- qualquer acesso futuro pelo navegador exigirá decisão explícita de produto, migration própria, RLS nominal e testes de autorização.

`supabase/migrations/0005_security_hardening.sql` consolida esse modelo depois da aplicação de `0001` a `0004`: habilita RLS em todas as tabelas públicas, revoga privilégios de `PUBLIC`, `anon` e `authenticated`, preserva o acesso do backend por `service_role` e corrige o `search_path` da função de imutabilidade do staging histórico.

`0005` também revoga `CREATE` no schema `public` para `PUBLIC`, `anon` e `authenticated`. Essa proteção atua sobre o schema e sobre os objetos existentes, mas não basta para objetos futuros quando os default privileges pertencem a outro papel criador.

Default privileges no PostgreSQL são específicos por papel definidor. Após aplicar `0001` a `0005` no Supabase de desenvolvimento, a auditoria de `pg_default_acl` mostrou que os objetos atuais da V2 foram criados por `postgres`, enquanto defaults herdados da plataforma pertencem a `supabase_admin`.

`supabase_admin` é um papel interno gerenciado pelo Supabase. O executor das migrations da aplicação não consegue alterar seus default privileges e não deve tentar `SET ROLE`, grant de papel interno, migration repair ou alteração administrativa desse owner.

`supabase/migrations/0006_protect_public_default_privileges.sql` trata exclusivamente o que é aplicável pela aplicação: default privileges futuros do owner `postgres` no schema `public`. O modelo é fail-closed: objetos futuros criados por migrations da aplicação não recebem grants automáticos para `PUBLIC`, `anon`, `authenticated` nem `service_role`.

Cada migration futura que criar tabela, sequence ou função deve conceder explicitamente ao `service_role` apenas os privilégios necessários para o backend server-side. Grants para navegador continuam proibidos por padrão e exigem decisão específica de produto, RLS nominal e testes de autorização.

Risco residual: defaults observados para `supabase_admin` permanecem como estado gerenciado da plataforma e devem ser monitorados pelos advisors. Como os objetos da V2 são criados por `postgres`, a proteção efetiva da aplicação fica concentrada no owner usado pelas migrations.

Qualquer exposição futura ao navegador deve ocorrer por migration própria com grants, policies e testes específicos.

## Índices de foreign keys

`supabase/migrations/0007_add_foreign_key_indexes.sql` adiciona índices B-tree de apoio para 22 foreign keys confirmadas no catálogo PostgreSQL sem cobertura por prefixo inicial.

A estratégia é intencionalmente conservadora:

- criar apenas índices no lado referenciador das FKs confirmadas;
- usar `CREATE INDEX IF NOT EXISTS`;
- qualificar tabelas com `public`;
- manter execução transacional, sem `CREATE INDEX CONCURRENTLY`, porque a migration ocorre antes da carga operacional;
- não remover índices reportados como `unused_index` antes de haver carga real e evidência de workload;
- não alterar RLS, grants, policies, funções, constraints ou dados.

Migrations futuras que criarem novas FKs devem criar índice de apoio na mesma migration, salvo quando PK, unique constraint ou índice composto existente já cobrir as colunas da FK como prefixo inicial e na mesma ordem.

## Overrides temporários de dependencias do Next

O projeto permanece em `next@15.5.22`.

Foram aplicados overrides temporários e restritos a árvore do Next para:

- `postcss@8.5.25`;
- `sharp@0.35.3`.

Motivo: corrigir vulnerabilidades de produção apontadas pelo `npm audit` em dependencias transitivas usadas pelo Next, sem alterar a versão do framework nesta etapa.

Com esses overrides, a auditoria de produção (`npm audit --omit=dev --offline=false`) fica zerada.

Obrigação futura: remover esses overrides quando uma versão futura do Next incorporar nativamente versões corrigidas e compativeis de PostCSS e Sharp.

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

## Autenticacao por trigrama

A V2 usa login exclusivamente por trigrama. O navegador envia apenas o valor digitado para `POST /api/auth/login`; a validacao do perfil ocorre somente no servidor por meio da interface `ProfileRepository`.

Fluxo implementado:

- `SupabaseProfileRepository` consulta `profiles` e `profile_roles` apenas no servidor.
- `FakeProfileRepository` permite testes unitarios sem banco real.
- `authenticateTrigram` normaliza e limita o formato do trigrama, consulta o repositorio, exige perfil ativo e retorna mensagem generica para trigrama inexistente, inativo ou malformado.
- login valido emite cookie assinado `HttpOnly` com `SameSite=Lax`; `Secure` e usado em producao.
- o cookie de sessao contem apenas `trigram`, `exp` e `nonce`; papeis administrativos nao sao fonte de autorizacao no token.
- toda requisicao administrativa recarrega o perfil ativo e os papeis atuais no servidor antes de autorizar `COORDINATOR` ou `ADMIN`.
- se o perfil estiver inativo, inexistente ou perder o papel administrativo, o acesso administrativo deve ser negado imediatamente.
- `SESSION_SECRET` e obrigatorio, deve ter pelo menos 32 caracteres e nao pode ser uma repeticao simples.
- `SESSION_DURATION_SECONDS` controla a duracao da sessao.
- `APP_ORIGIN` define a origem confiavel para endpoints mutaveis; o valor deve vir somente de variavel server-side.
- `POST /api/auth/login` e `POST /api/auth/logout` validam `Origin` e `Sec-Fetch-Site`; em producao, origem ausente ou incompativel e rejeitada com erro generico.
- em desenvolvimento, a ausencia de `APP_ORIGIN` ou `Origin` pode ser aceita para facilitar testes locais, mas producao deve configurar `APP_ORIGIN`.
- `POST /api/auth/logout` remove o cookie da sessao.
- `/portal` exige sessao valida.
- `/admin` e `/admin/roles` exigem `COORDINATOR` ou `ADMIN`.
- modulos que usam `SUPABASE_SECRET_KEY` sao marcados com `server-only` para impedir importacao por Client Components.

A lista de trigramas nunca e enviada ao navegador, e nenhum valor e salvo em `localStorage` ou `sessionStorage`.

Contratos de auditoria:

- o servico de login retorna um objeto `LoginAuditContract` com status, motivo interno, hash SHA-256 do trigrama e timestamp;
- a etapa atual nao grava esse contrato no banco real;
- o schema existente `audit_log` comporta registro futuro de login, acesso negado e acesso administrativo sem nova migration.

Nao foi criada migration nesta etapa. Persistencia de tentativas repetidas, bloqueio temporario por abuso ou sessoes revogaveis exigira estrutura adicional e deve ser diagnosticada antes de alterar o banco.

Riscos pendentes antes de producao:

- a migration de seguranca ainda precisa ser aplicada em ambiente isolado e validada com dados ficticios;
- diferencas temporais entre consulta de perfil inexistente e perfil existente/inativo devem ser observadas em homologacao com a camada persistente ativa;
- a rotina operacional de limpeza de sessoes e tentativas expiradas ainda precisa ser agendada.

## Seguranca persistente da autenticacao

`supabase/migrations/0004_auth_security_state.sql` adiciona a camada persistente de seguranca da autenticacao, sem alterar as migrations anteriores.

Tabelas criadas:

- `auth_rate_limit_buckets`: contadores de tentativas por janela.
- `auth_temporary_blocks`: bloqueios temporarios por escopo.
- `auth_sessions`: sessoes persistentes ativas, expiradas ou revogadas.
- `auth_audit_events`: eventos de login, bloqueio, logout e revogacao.

Privacidade:

- trigrama, IP, user-agent, token e nonce nunca devem ser gravados em texto aberto nessas tabelas;
- fingerprints sao HMAC-SHA256 com `AUTH_FINGERPRINT_SECRET`, separado de `SESSION_SECRET`;
- token bruto e nonce bruto nunca sao persistidos;
- `metadata` deve conter apenas contexto operacional nao identificavel.

Funcoes SQL:

- `auth_check_temporary_block`: verificacao preliminar de bloqueio, usada apenas como otimizacao.
- `auth_finalize_login_failure`: RPC transacional que adquire advisory locks em ordem deterministica, encerra bloqueios expirados, revalida bloqueio ativo, registra a falha e cria bloqueio quando o limite e atingido.
- `auth_finalize_login_success`: RPC transacional que adquire os mesmos locks, revalida bloqueio ativo, ajusta buckets, cria a sessao persistente e registra auditoria de sucesso na mesma transacao.
- `auth_touch_session`: valida sessao e limita escrita de `last_seen_at` ao intervalo configurado.
- `auth_revoke_session`: revoga sessao por HMAC do nonce.
- `auth_revoke_profile_sessions`: revoga todas as sessoes de um perfil.
- `auth_record_audit_event`: registra eventos sem identificadores em claro.
- `auth_cleanup_security_state`: limpa dados expirados conforme retencoes separadas.

As funcoes usam `SECURITY DEFINER` com `search_path` fixo. O acesso e revogado de `PUBLIC`, `anon` e `authenticated`; apenas `service_role` recebe `EXECUTE` nas RPCs indispensaveis. As tabelas ficam com RLS habilitado e sem politicas para o navegador.

Fluxo atualizado:

- antes de consultar perfil, o login calcula fingerprints e faz verificacao preliminar de bloqueio ativo;
- inexistente, inativo, invalido e bloqueado recebem resposta externa generica;
- falhas sao finalizadas por RPC transacional, que revalida bloqueio, incrementa contadores por trigrama e, quando houver origem confiavel, por rede e combinacao;
- a quinta falha e processada, registrada e cria bloqueio temporario; a sexta tentativa dentro da janela e recusada como bloqueada, sem virar nova falha comum;
- se existir bloqueio expirado ainda nao levantado para os mesmos fingerprints, a RPC marca `lifted_at` e `lifted_reason = EXPIRED` antes de criar novo ciclo;
- uma linha antiga de bloqueio nunca e sobrescrita para representar outro ciclo; `window_started_at`, `blocked_until` e `failed_attempts` permanecem auditaveis;
- login valido so emite cookie se a RPC transacional confirmar a criacao da sessao persistente ligada ao nonce por HMAC;
- rotas protegidas rejeitam sessao inexistente, expirada ou revogada no banco;
- logout revoga a sessao persistente e remove o cookie.

Origem de rede:

- em desenvolvimento, a origem de rede padrao e fixa: `LOCAL_DEVELOPMENT_NETWORK`;
- em producao, a aplicacao nao confia automaticamente em cabecalhos como `X-Forwarded-For`;
- se nao houver provedor confiavel configurado, o escopo de rede pode ser desabilitado e a protecao por trigrama permanece ativa;
- a integracao com um provedor especifico de hospedagem deve ser documentada antes de aceitar cabecalhos de rede.

Variaveis:

- `AUTH_FINGERPRINT_SECRET`: segredo server-side para HMAC de fingerprints.
- `LOGIN_MAX_ATTEMPTS`: padrao inicial `5`.
- `LOGIN_WINDOW_SECONDS`: padrao inicial `900`.
- `LOGIN_BLOCK_SECONDS`: padrao inicial `900`.
- `SESSION_TOUCH_INTERVAL_SECONDS`: padrao inicial `300`; limita a frequencia de atualizacao de `last_seen_at`.
- `AUTH_RATE_LIMIT_TRIGRAM_ENABLED`: habilita escopo por trigrama.
- `AUTH_RATE_LIMIT_NETWORK_ENABLED`: habilita escopo por rede quando houver origem confiavel.

Retencao inicial da limpeza:

- buckets vencidos: 24 horas apos fim da janela;
- bloqueios expirados ou levantados: 7 dias apos `lifted_at` ou, se nunca levantados manualmente, apos `blocked_until`;
- sessoes expiradas ou revogadas: 30 dias;
- auditoria: 365 dias.

`metadata` das tabelas de seguranca fica restrito a `{}` ate que exista uma allowlist aprovada. Nao gravar trigrama, IP, user-agent, token, nonce ou valores brutos em metadata.

Riscos ainda pendentes antes de producao:

- definir o provedor confiavel de origem de rede do ambiente de hospedagem;
- criar rotina agendada para `auth_cleanup_security_state`;
- definir politica operacional de rotacao de `AUTH_FINGERPRINT_SECRET`;
- avaliar protecao adicional contra negacao de servico direcionada a um trigrama especifico.
