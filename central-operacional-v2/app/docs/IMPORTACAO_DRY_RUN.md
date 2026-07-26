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

## Relatorio

O relatorio JSON contem:

- `read`: linhas lidas;
- `valid`: linhas validas;
- `invalid`: linhas invalidas;
- `duplicates`: linhas duplicadas;
- `normalized`: linhas em que algum valor foi normalizado;
- `issues`: problemas por linha;
- `operations`: operacoes idempotentes preparadas para futura gravacao.

Por padrao, o relatorio preserva os valores originais para auditoria, incluindo nome e e-mail quando existirem. Relatorios gerados a partir de dados reais nao devem ser compartilhados sem sanitizacao. Use `--redact` para ocultar `NOME`, `EMAIL`, `name` e `email` no JSON gerado.

## Limite historico

O importador nao inventa perfil historico. Quando nao houver evidencia de perfil vigente na epoca, a etapa futura de migracao devera registrar a limitacao como `perfil historico nao disponivel`.
