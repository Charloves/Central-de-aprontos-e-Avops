# Central Operacional V2 — Pacote para o Codex

Este pacote consolida as decisões e os requisitos para desenvolver a Central Operacional V2 sem Google Apps Script.

## Ordem de leitura

1. `AGENTS.md` — regras permanentes para o Codex.
2. `PRD_CENTRAL_OPERACIONAL_V2.md` — requisitos funcionais e critérios de aceite.
3. `ARQUITETURA_E_MODELO_DE_DADOS.md` — arquitetura proposta e entidades.
4. `REGRAS_DE_NEGOCIO.md` — regras operacionais detalhadas.
5. `PLANO_DE_MIGRACAO_E_TESTES.md` — implantação segura e preservação dos registros.
6. `PROMPT_INICIAL_CODEX.md` — mensagem pronta para iniciar o trabalho no repositório.

## Decisões já confirmadas

- Não utilizar Google Apps Script na V2.
- Manter acesso exclusivamente por trigrama.
- Manter AVOPs, aprontos e OI no Google Drive já compartilhado com os militares do QT.
- Manter separados os módulos AVOP, Apronto e OI.
- Não alterar nem interromper a Central atual durante o desenvolvimento.
- Publicar a V2 somente após homologação e conferência dos registros.
- Buscar operação sem custo mensal, respeitando as franquias gratuitas.
- Dissociar aplicação, dados, credenciais e administração do Gmail pessoal do coordenador atual.
