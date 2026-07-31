# Regras de negócio

## 1. Trigrama

- Normalizar para maiúsculas e remover espaços laterais.
- Aceitar somente perfil ativo.
- Não enviar a relação de trigramas ao cliente.
- Criar sessão assinada após validação.
- Registrar início e fim da sessão.
- Aplicar rate limit persistente antes da consulta do perfil.
- Tratar a verificacao inicial de bloqueio como otimizacao; a decisao final deve ocorrer na RPC transacional.
- Processar a quinta falha como tentativa valida que cria bloqueio; recusar a sexta como bloqueada.
- Encerrar bloqueio expirado com `lifted_at` e motivo `EXPIRED` antes de criar novo ciclo para os mesmos fingerprints.
- Nunca sobrescrever uma linha antiga de bloqueio para representar novo ciclo; cada ciclo deve gerar uma nova linha auditavel.
- Responder de forma externa generica para trigrama inexistente, inativo, invalido ou bloqueado.
- Nao armazenar trigrama, IP, user-agent, token ou nonce em claro nas tabelas de seguranca.
- Revogar a sessao persistente no logout e rejeitar imediatamente sessao revogada.
- Atualizar `last_seen_at` no maximo uma vez por intervalo configurado, para evitar escrita em toda requisicao.

## 2. Conteúdo aplicável

Uma atividade é exibida quando:

- está publicada/aberta;
- o usuário está ativo;
- existe interseção entre o público da atividade e os públicos do perfil;
- não há restrição administrativa adicional.

## 3. Ciência de AVOP

- Exigir confirmação explícita.
- Registrar somente uma primeira ciência por usuário e AVOP.
- Repetição retorna o registro existente sem criar duplicata.
- Abertura do link não equivale à ciência.
- Encerramento do AVOP impede novas ciências comuns; coordenador poderá registrar exceção auditada somente se a regra for criada depois.

## 4. Cobranças de AVOP

- Executar rotina diariamente.
- Considerar somente AVOP publicado, ativo e pendente.
- Manter a cadência atual até completar 30 dias da divulgação.
- A partir do 31º dia, cobrar mensalmente.
- Interromper quando:
  - houver ciência;
  - o AVOP for encerrado;
  - completar 365 dias;
  - o perfil ficar inativo;
  - o militar deixar de pertencer ao público aplicável.
- Armazenar `last_sent_at`, `next_send_at`, quantidade e resultado.
- Garantir que nova execução no mesmo dia não gere duplicidade.
- Usar Gmail API da conta funcional.
- Registrar falhas e permitir reprocessamento controlado.
- A cadência exata dos primeiros 30 dias deverá ser extraída do código atual e preservada.

## 5. Aprontos

- Permitir ações somente enquanto estiver aberto.
- Fechar automaticamente no início do quarto dia após a data do apronto.
- Registrar `closure_type = AUTOMATIC`.
- Reabertura somente por coordenador e sempre auditada.
- Não apagar presença, falta ou justificativa após o fechamento.
- Manter link do PDF no Drive.

## 6. Justificativa

- Vincular a usuário e apronto.
- Registrar data e hora.
- Preservar texto original ou histórico de versões.
- Não permitir que outro usuário altere a justificativa.
- Coordenador pode consultar nominalmente.

## 7. OI

- Filtrar por aeronave.
- Pesquisar por tipo de missão ou código.
- Aceitar código completo.
- Aplicar fallback para código-base somente conforme comportamento atual validado.
- Exibir páginas e documento corretos.
- Não escolher silenciosamente uma OI quando houver mais de uma correspondência; retornar as opções encontradas.
- Preservar o link original do Google Drive nos metadados.
- Não considerar abertura do documento como ciência.
- Não retornar OI inativa nas consultas operacionais comuns.
- Exigir link válido do Google Drive nos metadados importados.

## 8. Dashboard

- Perfis autorizados recebem apenas totais e percentuais.
- Coordenador e administrador podem acessar informação nominal.
- Percentuais devem informar denominador e ignorar perfis inativos quando aplicável.
- Resultados devem ser reproduzíveis por consulta.
- O dashboard atual pode ser reproduzido como visão operacional baseada no efetivo atual, mas não deve ser apresentado como reconstrução histórica exata quando não houver snapshot do perfil vigente na época.

## 9. Backup

- Gerar exportação periódica do banco.
- Gerar backup extraordinário antes de migrações.
- Salvar no Google Drive.
- Manter índice com data, checksum e situação.
- Arquivar o backup anterior sem excluí-lo.
- Testar restauração antes da publicação.

## 10. Auditoria

Registrar pelo menos:

- acesso;
- ciência;
- presença;
- falta;
- criação e alteração de justificativa;
- abertura, fechamento e reabertura;
- envio de cobrança;
- alteração de perfil e público;
- exportação e backup;
- ações administrativas.

Regras históricas:

- preservar registros existentes sem reescrever público, leitura, presença ou denominador antigo;
- registrar `perfil histórico não disponível` quando a base antiga não permitir comprovar o perfil vigente na data do evento;
- a partir da V2, salvar snapshot de público e perfil aplicável no momento da publicação de cada AVOP ou apronto;
- usar o snapshot da publicação como referência da auditoria histórica futura.
- armazenar o snapshot em formato nominal, com uma linha por militar aplicável e público/perfil considerado;
- preservar `migrated`, `source`, `source_reference` e `limitation_reason` quando a origem for importação ou quando o perfil histórico não puder ser comprovado.
