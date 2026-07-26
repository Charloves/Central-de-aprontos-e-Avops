# Importacao local em dry-run

## Objetivo

Validar arquivos exportados da base legada antes de qualquer gravacao real. Nesta fase o importador:

- le arquivos locais CSV ou JSON;
- nao acessa a planilha oficial;
- nao usa Google Apps Script;
- nao grava no Supabase;
- preserva os valores originais em cada operacao preparada;
- gera relatorio de leitura, validacao, normalizacao, duplicidade e operacoes idempotentes.

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

## Relatorio

O relatorio JSON contem:

- `read`: linhas lidas;
- `valid`: linhas validas;
- `invalid`: linhas invalidas;
- `duplicates`: linhas duplicadas;
- `normalized`: linhas em que algum valor foi normalizado;
- `issues`: problemas por linha;
- `operations`: operacoes idempotentes preparadas para futura gravacao.
- `metrics`: contagens especificas por tipo de registro quando a aba possuir metricas proprias.

Para aprontos e presencas, as metricas incluem contagens como `aprontos`, `fechados`, `presencas`, `faltas`, `justificativas` e `cienciasMaterial`.

Para staging de presencas, as metricas tambem incluem `stagingAmbiguos` e `stagingDuplicados`.

Por padrao, o relatorio preserva os valores originais para auditoria, incluindo nome, e-mail e justificativas quando existirem. Relatorios gerados a partir de dados reais nao devem ser compartilhados sem sanitizacao. Use `--redact` para ocultar `NOME`, `EMAIL`, `name`, `OBS`, `JUSTIFICATIVA` e `justificationText` no JSON gerado.

O `--redact` tambem sanitiza conteudos aninhados de staging, incluindo `original`, `normalized`, `original_content` e payloads preparados para compartilhamento.

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
