# Importacao local em dry-run

## Objetivo

Validar arquivos exportados da base legada antes de qualquer gravacao real. Nesta fase o importador:

- le arquivos locais CSV ou JSON;
- nao acessa a planilha oficial;
- nao usa Google Apps Script;
- nao grava no Supabase;
- preserva os valores originais em cada operacao preparada;
- gera relatorio de leitura, validacao, normalizacao, duplicidade e operacoes idempotentes.
- usa SHA-256 para identidades derivadas de conteudo sensivel, sem incluir numero fisico da linha.

## Comando

```powershell
& "C:\Program Files\nodejs\npm.cmd" run import:dry-run
```

Para gerar relatorio compartilhavel sem nome e e-mail:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run import:dry-run -- --redact
```

O comando padrao usa fixtures ficticias em:

- `fixtures/import/efetivo.csv`
- `fixtures/import/avops.csv`
- `fixtures/import/leituras.csv`
- `fixtures/import/aprontos.csv`
- `fixtures/import/presencas.csv`
- `fixtures/import/oi_h50.csv`
- `fixtures/import/oi_h125.csv`
- `fixtures/import/email_log.csv`
- `fixtures/import/acessos_log.csv`

## Formatos aceitos

Cada arquivo pode ser `.csv` ou `.json`. O JSON deve conter um array de objetos com os mesmos nomes de colunas do CSV.

### EFETIVO

Colunas obrigatorias:

- `ID`
- `NOME`
- `ATIVO`

Colunas opcionais reconhecidas:

- `EMAIL`
- `PERFIS`
- `PERFIL`

Regra: `PERFIS` tem prioridade sobre `PERFIL`. O importador normaliza trigrama para maiusculas e remove espacos. Publicos como `PILOTO E TRIPULANTES` sao normalizados para lista canonica.

Publicos canonicos aceitos:

- `PILOTO`
- `TRIPULANTE`
- `HSAR`
- `TODOS`

Valores desconhecidos nao sao descartados. Eles sao preservados no payload e geram warning nao fatal `UNKNOWN_AUDIENCE` para auditoria.

### AVOPS

Colunas obrigatorias:

- `AVOP_ID`
- `TITULO`
- `DATA_EMISSAO`
- `STATUS`
- `PERFIL_ALVO`
- `EXIGE_CIENCIA`

Colunas opcionais reconhecidas:

- `PRAZO_DIAS`
- `WEBAPP_URL`

Regra: identificadores como `AVOP-2026-01` e `AVOP 01-2026` sao normalizados para `AVOP 01-2026`.

Datas aceitas:

- `DD/MM/YYYY`
- `YYYY-MM-DD`
- timestamps no formato ISO, como `YYYY-MM-DDTHH:mm:ss-03:00`

Para evitar alteracao indevida de dia por fuso horario, o importador preserva a data civil escrita no arquivo e nao converte timestamps para UTC.

### LEITURAS

Colunas obrigatorias:

- `AVOP_ID`
- `ID`

Colunas opcionais reconhecidas:

- `DATA`
- `DATA_HORA`
- `TIMESTAMP`

Regra: a chave idempotente da leitura e formada por AVOP normalizado e trigrama normalizado. Duplicidades sao reportadas e nao interrompem o processamento.

### APRONTOS

Colunas obrigatorias:

- `APRONTO_ID`
- `TITULO`
- `DATA`
- `STATUS`
- `EXIGE_CIENCIA_MATERIAL`

Uma das colunas abaixo tambem deve existir e conter valor:

- `PERFIL_ALVO`
- `PUBLICO`

Colunas opcionais reconhecidas:

- `LINK_MATERIAL`

Regra: identificadores como `APR 2026 001` e `APR-2026-001` sao normalizados para `APR-2026-001`.

Estados conhecidos:

- `ABERTO`
- `FECHADO`
- `DRAFT`

Estados desconhecidos geram warning nao fatal e sao preservados para auditoria.

### PRESENCAS

Colunas obrigatorias:

- `APRONTO_ID`
- `ID`

Colunas opcionais reconhecidas:

- `DATA`
- `DATA_HORA`
- `TIMESTAMP`
- `STATUS`
- `OBS`
- `JUSTIFICATIVA`
- `CIENCIA_MATERIAL`

Estados conhecidos:

- `PRESENTE`
- `JUSTIFICADO`
- `AUSENTE`
- `PENDENTE`

O importador diferencia:

- presenca: `STATUS = PRESENTE`;
- falta: `STATUS = AUSENTE` ou `STATUS = JUSTIFICADO`;
- justificativa: texto em `OBS` ou `JUSTIFICATIVA`;
- ciencia de material: `CIENCIA_MATERIAL = SIM`.

Campos finais vazios sao preservados e nao sao tratados automaticamente como erro. Linhas com `APRONTO_ID` e `ID`, mas sem status, justificativa ou ciencia de material, geram warning `AMBIGUOUS_EMPTY_RECORD` e continuam no relatorio sem inventar classificacao.

A chave idempotente da presenca e formada por apronto normalizado e trigrama normalizado. Quando houver duplicidade na mesma chave, o dry-run preserva o primeiro registro valido, reporta `DUPLICATE_ROW` e mantem a linha original duplicada nos problemas para auditoria.

Quando uma linha tiver `APRONTO_ID` e `ID`, mas nao tiver `STATUS`, justificativa ou ciencia de material, o importador nao inventa presenca, falta ou justificativa. A linha gera uma operacao `stage`, com classificacao `ambiguous`, para futura analise manual.

Duplicidades historicas de `PRESENCAS` tambem geram operacao `stage` com classificacao `duplicate`, alem do issue `DUPLICATE_ROW`. Isso permite preservar o registro original sem duplicar a escrita futura em `briefing_records`.

### OI_H50 e OI_H125

Colunas obrigatorias:

- `OI_KEY`
- `PROGRAMA`
- `SUBPROGRAMA`
- `FASE_ID`
- `TITULO`
- `PDF_URL`
- `PAG_INICIAL`
- `PAG_FINAL`
- `TIPO`
- `STATUS`
- `CHAVE_EXIBICAO`

Colunas opcionais reconhecidas:

- `PDF_FASE_URL`
- `MISSOES`

Regra: `PDF_FASE_URL`, quando preenchido, tem prioridade sobre `PDF_URL`, pois representa o PDF ja dividido da fase. O link original efetivo e preservado no payload preparado. Nenhum arquivo e baixado ou aberto pelo importador.

Como os documentos oficiais permanecem no Google Drive, o link deve permitir extrair `drive_file_id`. Sao aceitos os formatos ja usados pelo sistema atual, como `/file/d/{id}/view`, `open?id={id}` e `uc?export=download&id={id}`. Link ausente ou link sem `drive_file_id` extraivel gera operacao `stage` com classificacao `invalid`; o importador nao inventa nem tenta corrigir URL.

`FASE_ID` deve seguir o formato `01HE01`. Missoes completas seguem o formato `01HE01D01`, com os dois ultimos digitos representando a sequencia. Variacoes legitimas de `OI_KEY` sao preservadas, mas a chave e normalizada para caixa alta e separadores `|` consistentes.

Linhas sem link de documento sao enviadas ao staging como `invalid`. Linhas com `PAG_FINAL` menor que `PAG_INICIAL` tambem sao enviadas ao staging como `invalid`, preservando os valores originais. Linhas com missoes que nao pertencem a `FASE_ID` sao enviadas ao staging como `ambiguous`, sem inventar fase, missao ou vinculo. Duplicidades e colisoes de chave tambem sao preservadas em staging.

`STATUS = INATIVO` nao invalida a linha. O registro e importado com `active = false`, preservando o estado historico, mas consultas operacionais comuns nao retornam OI inativa.

As metricas de OI sao separadas por aeronave e incluem `validosOi`, `invalidosOi`, `ambiguosOi`, `duplicadosOi` e `stagedOi`.

### EMAIL_LOG

Colunas obrigatorias:

- `DATA`
- `TIPO`
- `STATUS`

Colunas opcionais reconhecidas:

- `AVOP_ID`
- `ID`
- `EMAIL`
- `DESTINATARIO`
- `RECIPIENTE`
- `OBS`
- `DETALHE`
- `MENSAGEM`

O importador normaliza `AVOP_ID`, trigrama, data/hora, tipo e resultado. `LEMBRETE` e `TESTE_LEMBRETE` sao classificados como cobranca; `DIVULGACAO` e classificado como divulgacao; `JOB_COBRANCA` e preservado como evento de job quando aparecer.

Registros com `STATUS = ERRO` preservam a mensagem de erro em `errorMessage` e nao sao contabilizados como envio bem-sucedido. Linhas sem destinatario nao sao escritas como notificacao definitiva, porque `notification_log.recipient` e obrigatorio; elas seguem para staging como `ambiguous`, sem inventar recipiente.

Duplicidades usam chave deterministica SHA-256 baseada nos campos normalizados. A primeira ocorrencia valida permanece como operacao definitiva e a duplicata segue para staging.

Metricas especificas: `emailsEnviados`, `emailsErro`, `emailsCobranca`, `emailsDivulgacao`, `emailsOutros` e `stagingEmail`.

### ACESSOS_LOG

Colunas obrigatorias:

- `TIMESTAMP`
- `MODULO`
- `ACAO`
- `STATUS`

Colunas opcionais reconhecidas:

- `ID`
- `DETALHE`
- `OBS`
- `MENSAGEM`
- `IP`
- `USER_AGENT`

O importador normaliza trigrama, modulo, acao, status e data/hora. `LOGIN` com `OK` vira `LOGIN_VALIDO`; `LOGIN` com `NEGADO` vira `LOGIN_INVALIDO`; modulo `ADMIN` ou acao contendo `ADMIN` vira `ACESSO_ADMINISTRATIVO`.

Acesso `OK` sem trigrama e preservado em staging como `ambiguous`, pois nao ha evidencia suficiente para vincular a identidade. Registros duplicados tambem seguem para staging, preservando o primeiro registro valido.

Metricas especificas: `acessosOk`, `acessosNegados`, `loginsValidos`, `loginsInvalidos`, `acessosAdmin` e `stagingAcessos`.

## Relatorio

O relatorio JSON contem:

- `read`: linhas lidas;
- `valid`: linhas aceitas como operacoes definitivas futuras (`upsert`, `link` ou `acknowledge`), sem contar registros preservados apenas em `stage`;
- `invalid`: linhas invalidas;
- `duplicates`: linhas duplicadas detectadas; quando a preservacao historica for necessaria, a linha duplicada tambem aparece em `operations` como `stage`;
- `normalized`: linhas em que algum valor foi normalizado;
- `issues`: problemas por linha;
- `operations`: operacoes idempotentes preparadas para futura gravacao, incluindo operacoes definitivas e registros `stage` para auditoria historica.
- `metrics`: contagens especificas por tipo de registro quando a aba possuir metricas proprias.

Para aprontos e presencas, as metricas incluem contagens como `aprontos`, `fechados`, `presencas`, `faltas`, `justificativas` e `cienciasMaterial`.

Para staging de presencas, as metricas tambem incluem `stagingAmbiguos` e `stagingDuplicados`.

Para OI, as metricas indicam separadamente os registros de H-50 e H-125, alem de registros validos, invalidos, ambiguos, duplicados e enviados ao staging.

Por padrao, o relatorio preserva os valores originais para auditoria, incluindo nome, e-mail, trigramas, destinatarios, justificativas, erros, IP, user-agent e textos de OI quando existirem. Relatorios gerados a partir de dados reais nao devem ser compartilhados sem sanitizacao. Use `--redact` para ocultar `NOME`, `EMAIL`, `ID`, `trigram`, `recipient`, `OBS`, `DETALHE`, `MENSAGEM`, `errorMessage`, `IP`, `USER_AGENT`, `JUSTIFICATIVA`, `justificationText`, `TITULO`, `title`, `CHAVE_EXIBICAO` e `displayKey` no JSON gerado.

O `--redact` tambem sanitiza conteudos aninhados de staging, incluindo `original`, `normalized`, `original_content` e payloads preparados para compartilhamento. As `idempotencyKey` tambem sao ocultadas no relatorio compartilhavel, porque podem ser derivadas de e-mail, trigrama, IP, user-agent ou outros dados identificaveis.

## Identidade idempotente

As operacoes definitivas de `EMAIL_LOG` e `ACESSOS_LOG` usam `idempotencyKey` com SHA-256 dos campos normalizados relevantes. Isso evita expor diretamente e-mail, trigrama, IP ou texto de erro na chave operacional.

As operacoes `stage` usam fingerprint SHA-256 calculado a partir de:

- aba/origem;
- classificacao (`invalid`, `ambiguous`, `duplicate`, etc.);
- chave de origem normalizada quando existir;
- conteudo normalizado relevante;
- conteudo original serializado de forma canonica.

O `rowNumber` nao participa da identidade. Ele permanece apenas no payload de staging como metadado de auditoria para localizar a linha original. Se houver duas ou tres linhas exatamente identicas, o importador acrescenta um ordinal deterministico por ocorrencia do mesmo fingerprint. O conjunto de chaves gerado permanece estavel mesmo que as linhas do arquivo sejam reordenadas.

## Resolucao futura de staging

Um coordenador devera revisar cada registro em staging e escolher uma das opcoes:

- vincular a um registro definitivo ja existente;
- criar um registro definitivo com classificacao explicita;
- manter a linha como limitacao historica documentada.

A resolucao deve preencher `resolved_entity_type`, `resolved_entity_id`, `resolved_by`, `resolved_at` e `resolution_notes`. O conteudo original em JSONB deve permanecer inalterado para auditoria. A migration de staging bloqueia alteracoes em `original_content` com trigger.

## Identidade do lote

Quando a gravacao real for implementada, cada lote devera receber `source_file_hash` obrigatorio. O algoritmo definido e SHA-256 calculado sobre os bytes exatos do arquivo local antes do parse. A unicidade do lote considera `source`, `coalesce(source_reference, '')` e `source_file_hash`, para que reprocessar o mesmo arquivo nao crie duplicacao mesmo sem referencia externa.

## Limite historico

O importador nao inventa perfil historico. Quando nao houver evidencia de perfil vigente na epoca, a etapa futura de migracao devera registrar a limitacao como `perfil historico nao disponivel`.
