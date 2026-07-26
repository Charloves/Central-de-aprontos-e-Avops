# Prompt inicial para o Codex

Quero desenvolver a Central Operacional V2 com base nos arquivos deste pacote e no repositório existente.

Antes de editar qualquer arquivo:

1. leia integralmente `AGENTS.md` e os demais documentos;
2. inspecione o repositório atual;
3. identifique a arquitetura, os arquivos, as regras de negócio, as planilhas, os gatilhos e as dependências de contas;
4. não altere a Central atual nem a base oficial;
5. produza um diagnóstico comparando o estado atual com os requisitos da V2;
6. proponha um plano de implementação em etapas pequenas e reversíveis;
7. indique quais informações ou acessos realmente faltam;
8. defina como criar desenvolvimento, homologação e produção separados;
9. inclua estratégia de migração, conferência, backup, testes e retorno;
10. aguarde minha aprovação do plano antes de iniciar mudanças estruturais.

Decisões já confirmadas:

- a V2 não usará Google Apps Script;
- o acesso será exclusivamente por trigrama;
- os PDFs permanecerão no Google Drive compartilhado;
- os módulos AVOP, Apronto e OI continuarão separados;
- a V2 será publicada somente depois dos testes;
- os registros atuais não podem ser perdidos;
- a aplicação deve ser transferível e independente do Gmail pessoal;
- a operação deve buscar custo mensal zero;
- as cobranças continuarão automáticas;
- após 30 dias, cobranças de AVOP serão mensais até 365 dias, ciência ou encerramento;
- aprontos fecharão automaticamente no início do quarto dia após a realização.

Na primeira resposta, entregue apenas:

- diagnóstico do repositório;
- riscos;
- lacunas;
- arquitetura proposta;
- plano faseado;
- critérios de pronto;
- perguntas estritamente necessárias.
