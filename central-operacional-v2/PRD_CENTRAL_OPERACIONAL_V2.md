# PRD — Central Operacional V2

## 1. Finalidade

Disponibilizar um portal operacional para consulta e registro de AVOPs, aprontos e OI, com conteúdo personalizado conforme o perfil ativo do militar, gestão de pendências, auditoria e transferência administrativa.

## 2. Acesso e sessão

- O usuário informa apenas o trigrama.
- O servidor confronta o trigrama com os perfis ativos.
- Se válido, cria sessão temporária e carrega nome, perfil, públicos e permissões.
- O trigrama não é solicitado novamente durante a sessão.
- Deve existir opção de saída/troca de usuário.
- A sessão expira por inatividade.
- A aplicação registra acessos sem expor dados desnecessários.

## 3. Portal

Após o acesso, apresentar:

- identificação do usuário ativo;
- módulo AVOP;
- módulo Apronto;
- módulo OI;
- dashboard somente para perfis autorizados;
- área nominal somente para coordenador/gerente.

## 4. AVOP

- Listar somente AVOPs aplicáveis ao perfil do usuário.
- Exibir título, número, divulgação, situação e ações.
- Oferecer link para leitura/download no Google Drive.
- Exigir ação explícita de registro de ciência.
- Após a primeira ciência, desativar a ação e apresentar `AVOP assinado`, com data e hora.
- Impedir duplicidade.
- Preservar o primeiro registro como histórico imutável.
- Permitir encerramento pelo coordenador.

## 5. Apronto

- Listar somente aprontos aplicáveis ao perfil.
- Exibir título, data, situação e link do PDF no Drive.
- Permitir registro conforme regras atuais de presença/ciência.
- Permitir justificativa de falta.
- Preservar histórico da justificativa.
- Fechar automaticamente três dias após a realização.
- Permitir reabertura apenas ao coordenador, com auditoria.

## 6. OI

- Manter funcionamento conhecido.
- Permitir selecionar aeronave.
- Permitir pesquisar por tipo de missão ou código.
- Exibir resultado na mesma janela.
- Oferecer abrir OI e realizar nova pesquisa.
- Manter suporte a H-50 e estrutura preparada para H-125.
- Manter busca por código completo e fallback para código-base quando aplicável.

## 7. Dashboard

Para perfis autorizados, apresentar somente:

- total aplicável;
- leituras;
- pendências;
- percentual de cumprimento;
- indicadores simples de aprontos.

Para coordenador/gerente:

- auditoria nominal;
- filtros por atividade, público, situação e período;
- registros de ciência, presença, falta, justificativa e cobrança;
- exportação.

## 8. Documentos

- Os PDFs permanecem no Google Drive compartilhado existente.
- O banco guarda metadados, link e `fileId`.
- O acesso ao documento é controlado pelas permissões já existentes no Drive.
- Abrir ou baixar não equivale a ciência.
- O cadastro administrativo deve validar o formato do link.

## 9. Administração e transferência

- Perfis de aplicação: usuário, coordenador e administrador.
- Papéis e permissões ficam no banco, não fixos no código.
- Configurações ficam em tabela própria ou variáveis protegidas.
- Aplicação, banco, GitHub e e-mail funcional devem aceitar transferência de administração.
- Nenhum componente pode depender do Gmail pessoal do coordenador atual.

## 10. Operação sem custo

- Usar inicialmente franquias gratuitas.
- Monitorar armazenamento, execuções, tráfego e e-mails.
- Não habilitar cobrança automática de serviços sem autorização.
- Produzir alerta administrativo antes de atingir limites.
- Manter plano documentado para eventual migração de provedor.

## 11. Critérios gerais de aceite

- Todos os registros históricos conferem com a base anterior.
- Nenhuma assinatura ou justificativa é perdida.
- Usuário vê somente atividades relacionadas ao seu perfil.
- Documentos corretos abrem no Drive.
- Ações duplicadas são rejeitadas.
- Rotinas de cobrança e fechamento são idempotentes.
- Dashboard numérico e auditoria nominal respeitam as permissões.
- V2 funciona em homologação sem afetar a Central atual.
