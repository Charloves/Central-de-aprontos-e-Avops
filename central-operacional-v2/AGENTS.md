# Instruções permanentes — Central Operacional V2

## Objetivo

Desenvolver a Central Operacional V2 do 1º/11º GAV como aplicação web independente de Google Apps Script, preservando integralmente os registros e documentos da versão atual.

## Regras invioláveis

1. Não modificar, excluir, renomear ou reformatar dados da Central atual sem autorização expressa.
2. Não executar migração contra a base oficial durante o desenvolvimento.
3. Trabalhar inicialmente somente com cópias sanitizadas ou base de homologação.
4. Não perder registros históricos de ciência, assinatura, presença, falta ou justificativa.
5. Não alterar links do Google Drive até validar o arquivo substituto e a respectiva permissão.
6. Não armazenar segredos, tokens, IDs sensíveis ou credenciais no código ou no GitHub.
7. Não vincular a aplicação ao Gmail pessoal do coordenador.
8. Não substituir o acesso por trigrama por e-mail, senha ou conta Google. O trigrama é uma decisão confirmada.
9. Não considerar a abertura de um PDF como ciência automática.
10. Não publicar a V2 em produção sem aprovação expressa e cumprimento dos testes.

## Arquitetura preferida

- Aplicação: Next.js com TypeScript.
- Banco: PostgreSQL no Supabase Free.
- Hospedagem: solução gratuita compatível com aplicação Next.js.
- Código e histórico: GitHub.
- Documentos: links para arquivos no Google Drive compartilhado existente.
- Rotinas: agendamento no banco ou função serverless.
- E-mails: Gmail API de conta funcional, nunca Gmail pessoal.
- Backups: exportações externas versionadas para o Google Drive.

Propor mudança de arquitetura antes de implementá-la, explicando impacto em custo, transferência, dados e manutenção.

## Método de trabalho

Para cada tarefa:

1. inspecionar o repositório e os documentos;
2. apresentar diagnóstico e plano;
3. identificar riscos e dependências;
4. implementar alteração mínima e reversível;
5. criar ou atualizar testes;
6. executar validações;
7. revisar o diff;
8. registrar o que foi alterado e como testar.

## Qualidade

- Tipagem estrita.
- Validação de entradas no servidor.
- Sessão temporária assinada em cookie `HttpOnly`.
- Consultas parametrizadas.
- Registro de auditoria para operações relevantes.
- Idempotência em ciência, presença, cobrança e fechamento.
- Datas armazenadas em UTC; exibição em `America/Sao_Paulo`.
- Interface responsiva para computador e celular.
- Mensagens em português do Brasil.
- Não expor a lista completa de trigramas ao navegador.

## Ambientes

- `development`: desenvolvimento local.
- `homologation`: cópia controlada dos dados para testes.
- `production`: somente após homologação formal.

Cada ambiente deve ter banco, variáveis e credenciais separados.

## Definição de pronto

Uma alteração somente está pronta quando:

- atende aos critérios de aceite;
- preserva os registros preexistentes;
- possui migração reversível quando aplicável;
- passa nos testes automatizados;
- foi validada em homologação;
- não contém segredos;
- tem procedimento de retorno documentado.
