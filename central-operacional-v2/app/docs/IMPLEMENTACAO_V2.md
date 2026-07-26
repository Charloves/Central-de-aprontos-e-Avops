# Implementação da Central Operacional V2

## Objetivo desta base

Esta implementação inicial cria a fundação técnica da V2 sem alterar a Central atual, a planilha oficial ou os PDFs no Drive.

## Ordem recomendada de evolução

1. Criar projeto Supabase de desenvolvimento.
2. Aplicar `supabase/migrations/0001_initial_schema.sql`.
3. Configurar `.env.development.local` a partir de `.env.example`.
4. Importar uma cópia sanitizada das abas da planilha oficial.
5. Comparar contagens da importação com a planilha.
6. Implementar telas conectadas ao banco por módulo: autenticação, AVOP, Apronto, OI, dashboard e administração.
7. Criar ambiente de homologação com banco separado.
8. Publicar somente após conferência e aprovação formal.

## Regras já codificadas

- Normalização de trigrama.
- Normalização de formatos legados de AVOP.
- Perfis mistos e aliases de público-alvo.
- Busca OI por missão completa, fase e código parcial.
- Cobrança semanal de AVOP nos primeiros 30 dias.
- Cobrança mensal após 30 dias.
- Encerramento da cobrança por ciência, fechamento, inativação, saída do público-alvo ou 365 dias.
- `CHA` como coordenador/admin inicial.
- Transferência futura de coordenação por função auditável.

## Pontos ainda não conectados

- Consulta real ao Supabase nas páginas.
- Server actions/API routes de login e sessão por cookie.
- Importação automatizada diretamente da planilha.
- Envio real de e-mail por job agendado.
- Fechamento automático de aprontos.
- Backup externo para Google Drive.

## Segurança

Nenhum segredo deve ser commitado. Use somente arquivos `.env.*.local` para credenciais reais.
