# Sistema Central Operacional

## 1. Objetivo do sistema

O sistema centraliza tres frentes operacionais em uma unica interface web:

- `AVOP`: consulta de avisos operacionais, registro de ciencia e abertura do documento.
- `Apronto`: consulta de aprontos aplicaveis ao perfil do militar, registro de presenca/justificativa e ciencia do material.
- `OI`: consulta de Ordens de Instrucao por aeronave, fase e missao, com abertura do PDF da fase correta.

O acesso e controlado por `trigrama` validado na aba `EFETIVO` da planilha. Cada acao relevante gera rastreabilidade em planilha, principalmente para login, leitura, presenca e cobranca.

## 2. Componentes principais

### 2.1 Aplicacao web

- `Dev`: [https://script.google.com/macros/s/AKfycby1WesJsPQ0MEEfEVWwLA2i7shpUqfe5y9r5YfzcIQ/dev](https://script.google.com/macros/s/AKfycby1WesJsPQ0MEEfEVWwLA2i7shpUqfe5y9r5YfzcIQ/dev)
- `Exec`: [https://script.google.com/macros/s/AKfycby30KfwdIB5jk5qNM-NIfImsPzFpPlIT1Iw2uNBFeeDX2uU6HxLjzShHZLRgbVa7ahH/exec](https://script.google.com/macros/s/AKfycby30KfwdIB5jk5qNM-NIfImsPzFpPlIT1Iw2uNBFeeDX2uU6HxLjzShHZLRgbVa7ahH/exec)

### 2.2 Planilha base

- Planilha operacional: [CONTROLE AVOPS 2026](https://docs.google.com/spreadsheets/d/1iZ475yV1E5XQLZnWTMtKQm4wIRGwBNid8335mIiQDVE/edit)

### 2.3 Repositorio

- GitHub: [Charloves/Central-de-aprontos-e-Avops](https://github.com/Charloves/Central-de-aprontos-e-Avops)

## 3. Como o sistema funciona para o usuario

### 3.1 Entrada e autenticacao

1. O usuario acessa a central.
2. Informa o `trigrama`.
3. O sistema valida o trigrama na aba `EFETIVO`.
4. Se o registro estiver `ATIVO = SIM`, o sistema emite um token de sessao com validade de `12 horas`.
5. A partir desse ponto, o usuario opera os modulos sem precisar digitar novamente o trigrama ate a expiracao da sessao.

O token e assinado pelo script e cada acesso gera log na aba `ACESSOS_LOG`.

### 3.2 Modulo AVOP

Fluxo do usuario:

1. Seleciona o modulo `AVOP`.
2. Pode filtrar por `todos` ou `somente pendentes`.
3. Pode buscar por `AVOP_ID` ou titulo.
4. O sistema mostra somente AVOPs:
   - `ATIVOS`
   - com `EXIGE_CIENCIA = SIM`
   - aplicaveis ao `PERFIL/PERFIS` do militar
5. Ao clicar em `Registrar e ler`, o sistema:
   - registra a ciencia na aba `LEITURAS` se ainda nao existir
   - abre o AVOP diretamente no visualizador
6. Ao voltar, o usuario retorna para a lista de AVOPs ja carregada e com status atualizado.

O status exibido ao usuario e calculado a partir da combinacao `AVOP_ID + ID` na aba `LEITURAS`.

### 3.3 Modulo Apronto

Fluxo do usuario:

1. Seleciona o modulo `Aprontos`.
2. O sistema lista apenas aprontos aplicaveis ao seu perfil.
3. O usuario abre o apronto.
4. Dentro do apronto pode:
   - registrar `presenca`
   - registrar `justificativa`
   - registrar `ciencia do material`, quando exigida
5. O material, quando existir, pode ser aberto por link do Drive.

O sistema calcula o status final do usuario no apronto com base em:

- `STATUS`
- `CIENCIA_MATERIAL`

### 3.4 Modulo OI

Fluxo do usuario:

1. Seleciona a aeronave (`H50` ou `H125`).
2. Informa o codigo de fase ou missao.
3. O sistema consulta a aba `OI_H50` ou `OI_H125`.
4. A busca prioriza:
   - `missao exata`, por exemplo `01HE01D18`
   - `fase exata`, por exemplo `01HE01`
   - `parcial`, quando o usuario informa prefixo mais amplo
5. Se houver uma correspondencia exata de missao, o sistema retorna a fase correta.
6. Se houver varias fases possiveis para o prefixo informado, o sistema lista as opcoes.
7. O usuario abre a OI e o PDF da fase correspondente e aberto pelo link da coluna `PDF_FASE_URL`.

Refino atual da busca:

- Missao dentro da mesma sequencia retorna a mesma fase.
- Exemplos:
  - `01HE01D01` e `01HE01D18` retornam `ADAPTACAO DIURNA` da mesma fase.
  - `01HE01` retorna uma lista com as fases que compartilham esse `FASE_ID`.

## 4. Como o sistema funciona para o gerente do projeto

### 4.1 Fonte da verdade

A planilha e a base operacional do sistema. O Apps Script le os dados da planilha e grava nela:

- cadastro de efetivo
- catalogo de AVOPs
- leituras
- pendencias
- aprontos
- presencas
- base de OIs
- logs de acesso e e-mail

### 4.2 Rotinas administrativas disponiveis

No menu `AVOPS` da planilha existem funcoes administrativas:

- `Gerar WEBAPP_URL (lote)`: preenche links dos AVOPs.
- `Preparar coluna PERFIS no EFETIVO`: reorganiza/normaliza perfis para combinacoes mistas.
- `Atualizar pendencias AVOP`: reconstrui `PENDENCIAS` e `PENDENCIAS_RESUMO`, gerando backup antes.
- `Criar botao de divulgacao`: cria atalho visual na aba `AVOPS`.
- `Divulgar AVOP selecionado`: envia e-mail inicial para o publico-alvo do AVOP selecionado.
- `Testar cobranca (manual)`: dispara a rotina de cobranca de pendencias.

### 4.3 Divulgacao e cobranca de AVOP

O sistema diferencia dois tipos de e-mail:

- `DIVULGACAO`: envio inicial quando um novo AVOP e publicado.
- `LEMBRETE`: cobranca periodica de AVOP pendente.

Comportamento:

- O destinatario e escolhido com base em `PERFIL_ALVO` do AVOP e `PERFIS` do efetivo.
- O link enviado ja carrega um token individual.
- Quando o militar abre o AVOP pelo link individual, a ciencia e registrada automaticamente.
- Os envios sao registrados em `EMAIL_LOG`.
- O remetente configurado e lido de `CONFIG!B2`.

### 4.4 Controle de pendencias

O controle de pendencias nao fica mais por linha fixa de AVOP. Ele e reconstruido a partir de:

- `EFETIVO`
- `AVOPS`
- `LEITURAS`

Isso garante que:

- `TOTAL_APLICAVEIS` reflita o publico-alvo real
- `TOTAL_CIENTES` reflita quem efetivamente registrou ciencia
- `TOTAL_PENDENTES` reflita apenas quem ainda nao leu
- perfis mistos sejam tratados corretamente

### 4.5 OI por fase

As abas `OI_H50` e `OI_H125` armazenam:

- chave da OI
- programa
- subprograma
- `FASE_ID`
- titulo
- paginas no PDF original
- link do PDF da fase
- lista de `MISSOES`

Os PDFs por fase ficam desacoplados do PDF integral. Isso melhora a abertura do arquivo no celular e torna a busca por missao mais precisa.

## 5. Estrutura funcional da planilha

### 5.1 Abas operacionais

#### `CONFIG`

Funcao:

- guardar configuracoes basicas do sistema

Uso atual:

- `B1`: URL base do web app de producao
- `B2`: e-mail remetente para cobranca/divulgacao

#### `ACESSOS_LOG`

Funcao:

- registrar autenticacao e acoes dos usuarios

Colunas principais:

- `TIMESTAMP`
- `ID`
- `MODULO`
- `ACAO`
- `DETALHE`
- `STATUS`

#### `EFETIVO`

Funcao:

- base de usuarios aptos a acessar o sistema

Colunas principais:

- `ID`
- `NOME`
- `EMAIL`
- `ATIVO`
- `PERFIL`
- `PERFIS`

Observacao:

- `PERFIS` e a coluna recomendada para operacao atual.
- `PERFIL` ficou como legado/compatibilidade.
- O sistema suporta perfis mistos, por exemplo `PILOTO,TRIPULANTE`.

#### `AVOPS`

Funcao:

- catalogo mestre dos AVOPs

Colunas principais:

- `AVOP_ID`
- `TITULO`
- `DATA_EMISSAO`
- `PDF_URL`
- `PRAZO_DIAS`
- `WEBAPP_URL`
- `STATUS`
- `PERFIL_ALVO`
- `EXIGE_CIENCIA`

Uso:

- cada linha representa um AVOP que pode ou nao ser publicado aos usuarios
- a divulgacao inicial parte desta aba

#### `LEITURAS`

Funcao:

- registrar a ciencia de AVOP por militar

Colunas principais:

- `TIMESTAMP`
- `AVOP_ID`
- `ID`
- `NOME_INFORMADO`
- `IP`
- `USER_AGENT`

Uso:

- o par `AVOP_ID + ID` define se o usuario esta `CIENTE` ou `PENDENTE`

#### `EMAIL_LOG`

Funcao:

- registrar todos os envios e tentativas de e-mail

Colunas principais:

- `DATA`
- `AVOP_ID`
- `ID`
- `EMAIL`
- `TIPO`
- `STATUS`
- `OBS`

Tipos utilizados:

- `DIVULGACAO`
- `LEMBRETE`
- `TESTE_LEMBRETE`

#### `PENDENCIAS`

Funcao:

- materializar a matriz de pendencia por `AVOP x militar aplicavel`

Colunas principais:

- `AVOP_ID`
- `ID`
- `NOME`
- `EMAIL`
- `PERFIL`
- `PERFIL_ALVO`
- `STATUS`
- `DIAS_DESDE`
- `PRAZO`
- `VENCIDO`
- `LINK_WEBAPP`
- `PROXIMA_COBRANCA`

Uso:

- base para cobranca
- base para visao gerencial por pessoa

#### `PENDENCIAS_RESUMO`

Funcao:

- consolidar indicadores por AVOP

Colunas principais:

- `AVOP_ID`
- `TOTAL_APLICAVEIS`
- `TOTAL_CIENTES`
- `TOTAL_PENDENTES`
- `TOTAL_VENCIDOS`
- `PERCENTUAL_CIENCIA`
- `%PENDENTE`

Uso:

- base dos dashboards do chefe
- acompanhamento rapido da aderencia por AVOP

#### `APRONTOS`

Funcao:

- catalogo mestre dos aprontos

Colunas principais:

- `APRONTO_ID`
- `TITULO`
- `DATA`
- `PUBLICO`
- `STATUS`
- `LINK_MATERIAL`
- `EXIGE_CIENCIA_MATERIAL`
- `PERFIL_ALVO`

Observacao:

- existem vestigios de estrutura anterior em colunas mais a direita; a leitura operacional atual considera os campos principais usados pelo script.

#### `PRESENCAS`

Funcao:

- registrar presenca, justificativa e ciencia de material por militar e por apronto

Colunas principais:

- `TIMESTAMP`
- `APRONTO_ID`
- `ID`
- `STATUS`
- `OBS`
- `CIENCIA_MATERIAL`
- `DATA_CIENCIA_MATERIAL`
- `STATUS_FINAL`

#### `DASHBOARD_CHEFE`

Funcao:

- apresentar indicadores consolidados de AVOP

Conteudo observado:

- total de AVOPs no periodo
- total de pendencias
- total de vencidos
- percentual de ciencia
- cobrancas do dia
- resumo por AVOP
- ultimos lembretes enviados

#### `DASHBOARD_APRONTOS`

Funcao:

- painel de consolidacao de aprontos e presencas

Conteudo observado:

- total de aprontos
- abertos/fechados
- presentes/justificados/ausentes
- quadro de pendencias por apronto

Observacao:

- a aba depende de formulas e hoje ainda pode exigir refinamento visual e de consistencia em algumas secoes.

#### `OI_H50`

Funcao:

- base de consulta das OIs do H50

Colunas principais:

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
- `PDF_FASE_URL`
- `MISSOES`

#### `OI_H125`

Funcao:

- base de consulta das OIs do H125

Estrutura:

- mesma estrutura da aba `OI_H50`

### 5.2 Abas de backup

#### `PENDENCIAS_BKP_20260429_103712`

Funcao:

- snapshot historico automatico da aba `PENDENCIAS` antes de reconstrucao

#### `PENDENCIAS_RESUMO_BKP_20260429_103713`

Funcao:

- snapshot historico automatico da aba `PENDENCIAS_RESUMO` antes de reconstrucao

## 6. Arquivos principais do projeto

### `WebApp.js`

- ponto de entrada `doGet`
- roteamento de paginas
- endpoints de manutencao

### `Auth.js`

- autenticacao por trigrama
- emissao e validacao de token de sessao
- log de acessos
- compatibilidade de perfis mistos

### `Avops.js`

- listagem de AVOPs para o usuario
- registro de leitura
- abertura do visualizador de AVOP

### `Aprontos.js`

- listagem de aprontos
- regras de acesso por perfil
- presenca, justificativa e ciencia de material

### `Oi.js`

- busca de OIs
- refinamento por fase e missao
- geracao de viewer URLs
- carga de JSON para abas de OI

### `Pendencias.js`

- reconstrucao de `PENDENCIAS`
- reconstrucao de `PENDENCIAS_RESUMO`
- criacao de backups historicos

### `Código.js`

- configuracao geral
- menu da planilha
- montagem de links
- cobranca automatica/manual
- divulgacao de AVOP por e-mail

### `scripts/import_oi_h50.js` e `scripts/import_oi_h125.js`

- utilitarios locais para:
  - ler PDF integral
  - extrair indice
  - gerar PDFs por fase
  - extrair lista de missoes
  - subir arquivos para Drive
  - gerar JSON para importacao na planilha

## 7. Regras de negocio atuais

- somente militares `ATIVO = SIM` podem acessar
- os modulos respeitam o perfil do militar
- AVOP com `EXIGE_CIENCIA <> SIM` nao entra no fluxo de ciencia
- OI depende de trigrama valido, mas nao registra ciencia; registra acesso/uso
- perfis mistos sao aceitos em `EFETIVO`, `AVOPS` e `APRONTOS`
- o retorno de `OI` por missao e feito pela coluna `MISSOES`

## 8. Pontos de atencao para um futuro gerente

- a planilha e o banco do sistema; alteracoes de cabecalho afetam o Apps Script
- `PERFIS` deve ser priorizada em `EFETIVO`
- a aba `APRONTOS` ainda merece normalizacao estrutural completa para remover colunas legadas
- `DASHBOARD_APRONTOS` deve ser revisado sempre que formulas forem alteradas
- a conta remetente de e-mail depende da configuracao de alias/autorizacao no Gmail
- os PDFs de OI por fase precisam permanecer publicos para quem possui o link
- sempre testar no `/dev` antes de publicar no `/exec`

## 9. Fluxo recomendado de manutencao

1. Ajustar planilha ou codigo no ambiente local.
2. Publicar no deployment `dev`.
3. Validar comportamento funcional.
4. Atualizar a planilha, se necessario.
5. Publicar nova versao no `exec`.
6. Versionar no Git e enviar ao GitHub.

## 10. Estado atual resumido

- autenticacao por trigrama funcional
- AVOP com registro de ciencia e abertura direta funcional
- Apronto com presenca/justificativa/material funcional
- OI H50 e H125 com busca por `FASE_ID` e `MISSOES`
- divulgacao e cobranca de AVOP por e-mail funcional
- pendencias reconstruidas por publico-alvo real funcional
