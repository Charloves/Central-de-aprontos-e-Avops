# Plano de migração e testes

## Fase 0 — Auditoria

- Clonar o repositório existente.
- Inventariar arquivos, planilhas, abas, colunas, gatilhos, credenciais e contas.
- Identificar regras existentes de AVOP, Apronto e OI.
- Mapear dependências do Gmail pessoal.
- Registrar contagens oficiais por tabela.
- Registrar quais períodos possuem evidência de perfil histórico e quais devem receber a limitação `perfil histórico não disponível`.
- Não alterar produção.

## Fase 1 — Projeto-base

- Criar aplicação Next.js/TypeScript.
- Configurar banco de desenvolvimento.
- Criar ambientes separados.
- Configurar validações, testes e variáveis.
- Criar dados fictícios.

## Fase 2 — Modelo e importação

- Criar esquema SQL versionado.
- Criar importadores idempotentes para planilhas.
- Importar cópia dos dados.
- Produzir relatório de discrepâncias.
- Corrigir mapeamentos sem alterar origem.
- Preservar registros históricos sem recalcular retroativamente públicos, leituras, presenças ou denominadores.
- Criar snapshots de público e perfil aplicável somente para publicações realizadas a partir da V2.
- Criar snapshots nominais para AVOPs e aprontos, com uma linha por militar aplicável no momento da publicação/abertura.
- Marcar registros migrados e limitações de perfil histórico sem tentar corrigir retroativamente a base antiga.

## Fase 3 — Funcionalidades

Ordem:

1. trigrama e sessão;
2. perfis e públicos;
3. AVOP;
4. Apronto;
5. OI;
6. dashboard;
7. auditoria;
8. e-mails;
9. fechamento automático;
10. backup.

## Fase 4 — Homologação

- Publicar ambiente isolado.
- Usar cópia recente dos registros.
- Testar com usuários selecionados.
- Conferir documentos do Drive.
- Comparar resultados com a Central atual.
- Separar visão operacional atual de auditoria histórica exata.
- Registrar defeitos e evidências.

## Fase 5 — Migração final

- Definir janela de corte.
- Fazer backup integral.
- Suspender temporariamente novas gravações na versão anterior, se necessário.
- Exportar alterações posteriores à última cópia.
- Importar incrementalmente.
- Executar conferências.
- Publicar somente após aprovação.

## Fase 6 — Operação assistida

- Manter versão anterior disponível como contingência de leitura.
- Monitorar acessos, erros, e-mails e rotinas.
- Executar backup inicial pós-publicação.
- Documentar transferência ao coordenador.

## Testes mínimos

### Unidade

- normalização de trigrama;
- cálculo de aplicabilidade;
- ciência idempotente;
- cálculo da próxima cobrança;
- limite de 30 e 365 dias;
- fechamento após três dias;
- fallback de OI;
- percentuais do dashboard.

### Integração

- banco e API;
- sessão;
- Gmail API;
- links do Drive;
- importação de planilhas;
- backup e restauração.

### Segurança e permissões

- usuário não acessa dashboard nominal sem perfil;
- cliente não recebe lista de trigramas;
- rotas administrativas são protegidas;
- segredos não aparecem no repositório;
- entrada malformada é rejeitada.

### Migração

- contagem de perfis;
- contagem de AVOPs e aprontos;
- contagem de ciências;
- contagem de presenças;
- contagem de faltas e justificativas;
- amostragem nominal;
- conferência de registros marcados como `perfil histórico não disponível`;
- conferência de snapshots de público/perfil para registros criados na V2;
- conferência de quantidade nominal dos snapshots contra o público aplicável na data da publicação/abertura;
- validação de todos os links.

## Critério de publicação

Publicar somente quando:

- não houver discrepância não explicada;
- rotinas agendadas tiverem sido observadas em homologação;
- backup e restauração tiverem sido testados;
- houver procedimento de retorno;
- coordenador aprovar formalmente.
