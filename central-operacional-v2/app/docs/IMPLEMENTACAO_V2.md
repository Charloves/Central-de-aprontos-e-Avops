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
- Homologação e aplicação remota do fechamento automático de aprontos por Supabase Cron.
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

- `postcss@8.5.26`;
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

## Modulo OI funcional

A rota protegida `/portal/oi` consulta OIs ativas no servidor e reutiliza `src/lib/domain/oi-search.ts` como fonte unica da regra de busca. O usuario autenticado escolhe a aeronave `H-50` ou `H-125` e informa codigo completo, codigo-base/fase ou texto de missao. A entrada e validada por tamanho, caracteres permitidos e normalizacao segura antes da busca em memoria; nenhum filtro SQL e montado com texto livre do usuario.

O modulo e exclusivamente consultivo. Abrir o documento nao registra ciencia, auditoria operacional, presenca ou qualquer escrita em `ois`. A URL exibida e a URL efetiva ja armazenada no banco, que recebe `PDF_FASE_URL` quando o importador encontrou esse campo, ou `PDF_URL` como fallback. A pagina mostra o intervalo de paginas como orientacao textual e nao inventa parametros de pagina para o Google Drive.

Os links usam a mesma validacao dos modulos AVOP e Apronto: em producao apenas `https://drive.google.com`; em desenvolvimento e teste, `https://drive.google.com` e `https://example.test`. URLs com HTTP, credenciais, host semelhante, `javascript:`, `data:` ou formato invalido sao bloqueadas na interface.

O acesso ao banco usa somente `SUPABASE_SECRET_KEY` em modulo `server-only`. A pagina exige sessao persistente valida via `requireSession()`, de modo que perfil inexistente, inativo, sessao revogada, adulterada ou expirada nao acessa a consulta. Nenhuma policy de navegador foi criada para `ois`.

## Dashboard gerencial e auditoria nominal

As rotas protegidas `/admin/dashboard` e `/admin/auditoria` sao restritas a perfis ativos com papel atual `COORDINATOR` ou `ADMIN`. A autorizacao reutiliza `requireAdminSession()`, que revalida sessao persistente, perfil ativo e papeis atuais no servidor a cada requisicao. Papel enviado pelo navegador nunca participa da decisao.

O dashboard numerico usa agregacao server-side em TypeScript sobre o schema existente. Nenhuma view, RPC ou migration adicional foi necessaria nesta primeira versao. O repositorio Supabase fica em modulo `server-only`, usa `SUPABASE_SECRET_KEY` apenas no backend e carrega somente as tabelas necessarias para AVOPs, aprontos, publicos, snapshots, ciencias, registros e justificativas.

Fontes de denominador:

- `SNAPSHOT`: usa membros nominais de `avop_publication_snapshot_members` ou `briefing_publication_snapshot_members`.
- `OPERATIONAL_CURRENT`: usa perfis ativos e publicos vigentes atuais quando nao ha snapshot. Essa visao e operacional e nao reconstrucao historica exata.
- `HISTORICAL_UNAVAILABLE`: exibido quando o snapshot ou suas limitacoes indicam perfil historico indisponivel.

Regras de calculo:

- o mesmo militar conta uma unica vez por AVOP ou apronto, mesmo quando pertence a multiplos publicos;
- publicos mistos sao reconciliados por `profile_id`;
- ciencia de AVOP repetida conta uma vez e preserva a primeira data na auditoria nominal;
- justificativas multiplas do mesmo militar contam uma pessoa no dashboard, preservando o historico nominal;
- justificativa nao vira presenca;
- ciencia de material nao vira presenca;
- ausencia de registro e status `PENDENTE` aparecem como pendencia ou sem classificacao;
- divisao por zero retorna `0,0%`, sem `NaN` ou `Infinity`;
- percentuais usam uma casa decimal.

A auditoria nominal pagina os resultados no servidor e nao envia toda a base para Client Components. A pagina exibe apenas nome, trigrama, publicos aplicaveis, situacao, data e limitacao historica. Ela nao exibe e-mail, tokens, hashes de sessao, nonce, IP, fingerprints ou metadata de autenticacao.

Limite atual: os denominadores de registros antigos sem snapshot sao rotulados como `OPERATIONAL_CURRENT`. Eles servem para gestao operacional, mas nao devem ser tratados como auditoria historica exata ate que a migracao preserve ou resolva evidencia nominal adequada.

## Módulo AVOP inicial

A primeira versão funcional do módulo AVOP está disponível em `/portal/avops`.

Regras implementadas:

- a rota exige sessão válida e não revogada;
- o perfil ativo e os papéis continuam sendo recarregados no servidor;
- a listagem usa somente o `profileId` derivado da sessão server-side;
- o navegador nunca informa `profile_id` ou trigrama para consultar ou assinar AVOP;
- são exibidos apenas AVOPs `PUBLISHED` com interseção entre os públicos do perfil atual e os públicos do AVOP;
- um AVOP destinado a `TODOS` é exibido para qualquer perfil ativo com público vigente;
- perfis mistos são tratados por interseção de públicos, incluindo `PILOTO`, `TRIPULANTE`, `HSAR` e combinações;
- o documento abre diretamente pela `drive_url` armazenada, sem download, cópia ou proxy pelo servidor;
- em produção, a `drive_url` precisa ser `https://drive.google.com` com hostname exato e sem credenciais na URL;
- em `development` e `test`, `https://example.test` também é aceito para homologação com links fictícios sem abrir documentos reais;
- abrir o documento não registra ciência;
- a ciência exige ação explícita em `POST /api/avops/acknowledge`;
- antes da escrita, o servidor revalida sessão, perfil ativo, aplicabilidade, status `PUBLISHED`, exigência de ciência e link de documento válido;
- a ciência registra `session_id` persistente da sessão já validada, sem armazenar token bruto no registro de AVOP;
- a escrita em `avop_acknowledgements` é idempotente pela constraint única `(avop_id, profile_id)`;
- em conflito concorrente, o backend retorna a primeira ciência existente e preserva `acknowledged_at`;
- falhas retornam mensagem genérica ao usuário, sem expor detalhes de banco.

Limitação atual: o schema ainda não possui campo de prazo específico de AVOP. Enquanto esse dado não existir, a interface exibe `Sem prazo definido`.

## Administração de publicações

A primeira versão administrativa para criação e publicação está disponível em:

- `/admin/avops`
- `/admin/avops/novo`
- `/admin/aprontos`
- `/admin/aprontos/novo`

Regras implementadas:

- somente sessões com papel atual `COORDINATOR` ou `ADMIN`, recarregado no servidor, podem acessar as telas;
- rascunhos podem ser criados e editados enquanto estiverem em `DRAFT`;
- registros publicados não podem ter público ou dados essenciais alterados silenciosamente por essas telas;
- a identidade administrativa vem exclusivamente da sessão server-side;
- campos enviados pelo navegador como `profile_id`, trigrama, papel, `actor_profile_id` ou `session_id` são rejeitados;
- URLs seguem a validação dos módulos operacionais: em produção apenas `https://drive.google.com`; em desenvolvimento/teste também `https://example.test`;
- a publicação é explícita e chama RPC backend-only com `SUPABASE_SECRET_KEY`;
- a RPC cria atomicamente o estado publicado, os vínculos de públicos, um único snapshot nominal, os membros aplicáveis e o evento em `audit_log`;
- `TODOS` inclui todos os perfis ativos no momento da publicação;
- combinações de `PILOTO`, `TRIPULANTE` e `HSAR` usam união de perfis ativos;
- militar em mais de um público conta uma única vez no denominador, mas o snapshot preserva os públicos que o tornaram aplicável;
- publicação repetida retorna o snapshot existente e não duplica membros ou auditoria;
- registros históricos e snapshots já existentes não são reconstruídos nem modificados.

Eventos mínimos de auditoria:

- `AVOP_DRAFT_CREATED`
- `AVOP_PUBLISHED`
- `BRIEFING_DRAFT_CREATED`
- `BRIEFING_PUBLISHED`

Ponto de integração futuro: a rotina de divulgação e cobrança por e-mail deve iniciar a partir do evento de publicação e do snapshot nominal preservado, sem recalcular o público histórico.

## Divulgação e cobrança de AVOP por e-mail

A primeira versão local do mecanismo de e-mail fica isolada em módulos `server-only` e expõe o endpoint `POST /api/cron/avop-notifications` para futura execução por Vercel Cron. O endpoint exige `CRON_SECRET`, compara o segredo de forma segura e retorna erro genérico quando a configuração estiver ausente, fraca ou divergente. O modo padrão é `AVOP_EMAIL_MODE=dry-run`; envio real via Gmail só ocorre futuramente com `AVOP_EMAIL_MODE=gmail` e variáveis Gmail configuradas no servidor.

Regras temporais implementadas:

- divulgação inicial no primeiro processamento após a publicação;
- cobranças nos marcos de 7, 14, 21 e 28 dias;
- cobranças mensais a partir do segundo mês, usando o mesmo dia-base da publicação ou o último dia do mês quando necessário;
- encerramento após 365 dias.

O processamento cessa quando há ciência, quando a AVOP está `CLOSED`, quando o perfil fica inativo, quando o militar deixa de pertencer ao público aplicável ou quando ocorre erro permanente de e-mail. A entrada posterior em um público aplicável é tratada como pendência operacional atual, sem alterar o snapshot histórico da publicação.

A migration `20260818120552_avop_email_notifications.sql` amplia `notification_schedule` e `notification_log` com marcador de cobrança, reserva por hash de token, chave idempotente SHA-256, contadores, erro permanente e motivo de encerramento. As RPCs `list_avop_notification_candidates`, `reserve_avop_notification` e `record_avop_notification_result` ficam sem acesso para `PUBLIC`, `anon` e `authenticated`; somente `service_role` pode executá-las. O navegador não recebe acesso direto às tabelas nem às RPCs.

Os e-mails são montados em português, com identificação e título da AVOP e link para a Central. O PDF do Drive não é usado como ciência automática. O corpo completo do e-mail, tokens OAuth, refresh token, segredo de cron e credenciais não são gravados no banco nem em logs. Cabeçalhos e destinatários continuam sujeitos às validações MIME já implementadas no módulo Gmail.

## Módulo Apronto inicial

A primeira versão funcional do módulo Apronto está disponível em `/portal/aprontos`.

Regras implementadas:

- a rota exige sessão válida e não revogada;
- a listagem usa somente o `profileId` derivado da sessão server-side;
- o navegador nunca informa `profile_id`, trigrama ou `session_id` para consultar ou alterar aprontos;
- são exibidos apenas aprontos não rascunho com interseção entre os públicos do perfil atual e os públicos do apronto;
- um apronto destinado a `TODOS` é exibido para qualquer perfil ativo com público vigente;
- perfis mistos são tratados por interseção de públicos, incluindo `PILOTO`, `TRIPULANTE`, `HSAR` e combinações;
- o material abre diretamente pela `drive_url` armazenada, sem download, cópia ou proxy pelo servidor;
- em produção, a `drive_url` precisa ser `https://drive.google.com` com hostname exato e sem credenciais na URL;
- em `development` e `test`, `https://example.test` também é aceito para homologação com links fictícios;
- abrir o material não registra ciência;
- a ciência de material exige ação explícita em `POST /api/aprontos/material`;
- a justificativa exige ação explícita em `POST /api/aprontos/justify`;
- as duas ações validam CSRF por `APP_ORIGIN`, sessão, perfil ativo, aplicabilidade e estado efetivo do apronto;
- apronto `CLOSED`, rascunho, data inválida ou fechamento efetivo bloqueiam ações;
- o fechamento efetivo ocorre no início do quarto dia após a data de realização, em `America/Sao_Paulo`;
- enquanto o job automático não existir, o servidor calcula esse fechamento a cada requisição e não depende apenas do status persistido;
- a ciência de material é idempotente por `(briefing_id, profile_id)` em `briefing_records` e preserva o primeiro `recorded_at`;
- se não houver registro anterior, a ciência de material cria `attendance_status = PENDENTE`, sem inventar presença ou falta;
- justificativas são registradas em `absence_justifications`, sem transformar justificativa em presença;
- nova justificativa enquanto o apronto estiver aberto cria novo registro e preserva histórico; a interface exibe a mais recente;
- registros legados vazios ou ambíguos são exibidos sem serem reinterpretados como presença, falta, justificativa ou ciência;
- presença fica somente como leitura histórica nesta primeira versão. O usuário comum não recebe ação para se declarar `PRESENTE`.

Limitação atual: o schema possui `material_acknowledged` e `recorded_at` em `briefing_records`, mas não possui timestamp separado para a ciência de material. Nesta primeira versão, o primeiro `recorded_at` do registro é preservado para idempotência. Se a auditoria exigir separar presença e ciência de material no futuro, será necessária migration própria.

## Fechamento automático de aprontos

`supabase/migrations/20260811132644_auto_close_briefings_cron.sql` prepara o fechamento persistente dos aprontos por Supabase Cron/pg_cron. A migration ainda precisa ser aplicada em development antes da homologação funcional desse job.

Estrutura:

- cria a extensão `pg_cron` se ainda não existir;
- cria o schema interno `internal`, sem acesso para `PUBLIC`, `anon` ou `authenticated`;
- cria `internal.auto_close_due_briefings(p_now timestamptz default now())` com `SECURITY INVOKER` e `search_path = pg_catalog, pg_temp`;
- agenda o job estável `central_operacional_auto_close_briefings` com cron `0 * * * *`;
- o job executa diretamente `select internal.auto_close_due_briefings();`, sem endpoint HTTP, URL, token ou segredo.

Regra temporal:

- apenas aprontos com `status = OPEN` e `event_date` não nula são elegíveis;
- o limite é calculado com `(p_now AT TIME ZONE 'America/Sao_Paulo') >= (event_date + 3)::timestamp`;
- exemplo: apronto realizado em 10/08 fecha a partir de 13/08 00:00 no fuso `America/Sao_Paulo`;
- `p_now` é parâmetro explícito para testes e usa `now()` somente como padrão operacional.

Concorrência e auditoria:

- o fechamento usa operação set-based com `FOR UPDATE SKIP LOCKED` e `UPDATE ... RETURNING`;
- execuções repetidas ou concorrentes não fecham o mesmo apronto duas vezes;
- aprontos já `CLOSED` ou fechados manualmente não são sobrescritos;
- para cada apronto efetivamente fechado, a função grava uma linha em `audit_log` com `action = BRIEFING_AUTO_CLOSED`;
- reexecução sem mudança não gera auditoria;
- nenhum `briefing_record`, justificativa, ciência de material, presença, falta ou snapshot é criado ou alterado pelo fechamento.

O estado efetivo calculado pela aplicação continua bloqueando ações no prazo exato, mesmo se o cron atrasar alguns minutos.

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
- login valido emite cookie `HttpOnly` opaco com `SameSite=Lax`; `Secure` e usado em producao.
- o cookie de sessao contem apenas um identificador aleatorio opaco, sem trigrama, `profile_id`, papeis, nonce ou expiracao legivel.
- a expiracao e a revogacao sao verificadas em `auth_sessions`; o navegador nunca recebe dados de autorizacao.
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
- `auth_touch_session`: RPC legada preservada para compatibilidade; o caminho operacional atual valida sessoes pelo `session_identifier_hash` em consulta server-only.
- `auth_revoke_session`: RPC legada preservada para compatibilidade; o caminho operacional atual revoga sessoes pelo `session_identifier_hash` em consulta server-only.
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
- login valido so emite cookie se a RPC transacional confirmar a criacao da sessao persistente ligada ao identificador opaco por HMAC;
- rotas protegidas calculam HMAC do identificador opaco, localizam a sessao persistente por `session_identifier_hash`, rejeitam sessao inexistente, expirada ou revogada e recarregam perfil ativo e papeis atuais pelo servidor;
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

## Transferencia administrativa

A rota `/admin/roles` permite transferir `ADMIN` e `COORDINATOR` juntos para outro perfil ativo, mantendo `USER` no executor e no destino.

Contrato da interface:

- lista somente nome, trigrama e papeis atuais de perfis ativos com `ADMIN` ou `COORDINATOR`;
- nao exibe e-mail por padrao;
- exige trigrama do destino, repeticao do trigrama e confirmacao textual `TRANSFERIR ADMINISTRACAO`;
- nao envia `profile_id`, `actor_profile_id`, `assigned_by`, `session_id` ou papeis pelo navegador;
- apos sucesso, redireciona o executor para o portal comum, pois ele perde acesso administrativo imediatamente.

Contrato de seguranca:

- a identidade do executor vem exclusivamente da sessao persistente server-side;
- a rota POST `/api/admin/roles/transfer` aplica CSRF fail-closed por `APP_ORIGIN`;
- o servidor exige que o executor ainda tenha `ADMIN` no perfil ativo recarregado do banco;
- destino inexistente, inativo, igual a origem ou invalido retorna falha generica;
- papeis administrativos nunca entram no cookie.

Banco:

- `internal.transfer_management_roles(uuid, text, timestamptz)` contem a implementacao transacional;
- a funcao usa advisory transaction lock estavel, revalida origem/destino apos o lock e faz papeis + auditoria na mesma transacao;
- a aplicacao da migration nao executa transferencia automaticamente;
- `public.transfer_management_roles(uuid, text, timestamptz)` e apenas um wrapper backend-only para chamada via Supabase Data API, ja que o schema `internal` nao e exposto ao PostgREST;
- `PUBLIC`, `anon` e `authenticated` nao recebem `EXECUTE`; somente `service_role` pode chamar;
- `audit_log.action = MANAGEMENT_ROLES_TRANSFERRED` preserva o historico real das transferencias, sem gravar trigrama em metadata.
