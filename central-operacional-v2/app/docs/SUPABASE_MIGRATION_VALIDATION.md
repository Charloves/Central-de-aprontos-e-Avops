# Validacao das migrations em Supabase isolado

Este roteiro prepara a validacao das migrations `0001` a `0004` da Central Operacional V2 em um projeto Supabase exclusivo de desenvolvimento. Nao usar a planilha oficial, dados reais, URLs reais de Drive, e-mails reais ou credenciais versionadas.

## Escopo

- Aplicar as migrations em projeto vazio e descartavel.
- Validar tabelas, constraints, RLS, grants e RPCs.
- Validar o fluxo persistente de seguranca da autenticacao.
- Gerar tipos TypeScript somente depois da aplicacao bem-sucedida.
- Descartar o projeto de teste ao final pela exclusao manual no painel.

## Estado da preparacao local

- Supabase CLI fixada em `supabase@2.111.0`.
- Validacao local aprovada com `152` testes e `next build` concluido com sucesso.
- Nenhuma conexao Supabase, `login`, `link`, dry-run remoto, `db push`, seed, reset ou migration aplicada foi executada nesta etapa.
- `npm audit --omit=dev` ainda nao esta limpo por vulnerabilidades preexistentes de producao em dependencias como Next/sharp/postcss e googleapis/uuid.
- A correcao dessas vulnerabilidades e requisito obrigatorio antes de qualquer implantacao.
- Nao usar `npm audit fix` automaticamente; qualquer atualizacao deve ser controlada, revisada e validada por testes de regressao.

## Credenciais

Credenciais devem ser configuradas somente por uma das opcoes abaixo:

- Autenticacao local da Supabase CLI feita manualmente fora do Git.
- Arquivo `.env.local`, ignorado pelo Git.
- Variaveis de ambiente da sessao do PowerShell.

Nunca versionar:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AUTH_FINGERPRINT_SECRET`
- `SESSION_SECRET`
- project ref real
- connection string

Variaveis obrigatorias para o dry-run seguro:

```text
SUPABASE_DEV_PROJECT_REF=<PROJECT_REF_DE_DESENVOLVIMENTO>
SUPABASE_TARGET_ENV=development
```

## Scripts npm disponiveis

Executar dentro de `central-operacional-v2/app`.

```powershell
& "C:\Program Files\nodejs\npm.cmd" run supabase:version
& "C:\Program Files\nodejs\npm.cmd" run supabase:migrations:list
& "C:\Program Files\nodejs\npm.cmd" run supabase:validate:dev
& "C:\Program Files\nodejs\npm.cmd" run supabase:db:push:dry-run
& "C:\Program Files\nodejs\npm.cmd" run supabase:types:dev
```

Observacoes:

- `supabase:version` verifica a CLI local instalada no projeto.
- `supabase:migrations:list` lista apenas os arquivos locais de migration.
- `supabase:validate:dev` faz validacao estatica da preparacao local e do seed ficticio.
- `supabase:db:push:dry-run` usa wrapper seguro, valida `SUPABASE_DEV_PROJECT_REF`, exige `SUPABASE_TARGET_ENV=development`, confere `supabase/.temp/project-ref` e executa somente `supabase db push --dry-run`.
- `supabase:types:dev` deve ser executado apenas depois que as migrations forem aplicadas no banco de desenvolvimento.

Telemetria da CLI:

- A CLI `supabase@2.111.0` tentou gravar arquivo de telemetria em `~/.supabase` durante `supabase --version` no sandbox.
- Nao foi encontrada, no pacote instalado, documentacao local confirmada de uma variavel oficial para desabilitar telemetria.
- Nao redirecionar diretorios globais nem alterar configuracao do usuario para contornar isso.
- Se `supabase:version` falhar no sandbox, validar no PowerShell normal ou usar `npm ls supabase --depth=0` como verificacao local alternativa da versao instalada.

## Acoes manuais no painel do Supabase

1. Criar um projeto novo, vazio e exclusivo para desenvolvimento da V2.
2. Nao reutilizar o projeto de producao, homologacao real ou qualquer banco com dados oficiais.
3. Anotar o project ref apenas em local seguro fora do Git.
4. Configurar secrets reais somente no ambiente local ou na plataforma de deploy futura.
5. Antes de qualquer dry-run, confirmar no painel o nome visivel do projeto e o project ref.
6. Ao final da validacao, descartar o projeto pela exclusao manual no painel, apos conferencia.

Nunca executar:

- `supabase db reset --linked`
- `supabase db reset` contra URL remota
- reset para limpar projeto remoto
- seed em projeto que nao seja o desenvolvimento isolado confirmado

## Sequencia de validacao

1. Confirmar CLI:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run supabase:version
```

2. Confirmar arquivos locais:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run supabase:migrations:list
& "C:\Program Files\nodejs\npm.cmd" run supabase:validate:dev
```

3. Autenticar e vincular manualmente o projeto isolado, fora desta etapa:

```powershell
supabase login
supabase link --project-ref <PROJECT_REF_DE_DESENVOLVIMENTO>
```

4. Checklist obrigatorio imediatamente antes do dry-run:

- nome visivel do projeto no painel Supabase conferido;
- project ref conferido no painel;
- `SUPABASE_DEV_PROJECT_REF` em `.env.local` ou ambiente confere exatamente com o painel;
- `SUPABASE_TARGET_ENV=development`;
- projeto e descartavel e exclusivo de desenvolvimento;
- projeto nao e producao, homologacao, staging ou ambiente futuro de corte;
- `supabase/.temp/project-ref` confere com `SUPABASE_DEV_PROJECT_REF`;
- Central atual e planilha oficial estao fora do processo.

5. Executar dry-run seguro:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run supabase:db:push:dry-run
```

6. Aplicar migrations somente apos revisar o dry-run e repetir o checklist:

```powershell
supabase db push
```

7. Conferir no SQL Editor ou psql conectado ao projeto isolado:

```sql
select tablename from pg_tables where schemaname = 'public' order by tablename;
select typname from pg_type where typnamespace = 'public'::regnamespace order by typname;
select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;
```

8. Conferir RLS e grants das tabelas de seguranca:

```sql
select table_name, privilege_type, grantee
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'auth_%'
order by table_name, grantee, privilege_type;
```

9. Conferir RPCs:

```sql
select routine_name, security_type
from information_schema.routines
where specific_schema = 'public'
  and routine_name like 'auth_%'
order by routine_name;
```

10. Validar cinco falhas e bloqueio com fingerprints ficticios HMAC-SHA256 de teste, nunca dados reais.

11. Validar sexta tentativa recusada:

- deve retornar bloqueio;
- nao deve incrementar falha comum;
- deve registrar auditoria de bloqueio sem dados pessoais em claro.

12. Validar login, sessao e logout:

- login valido cria `auth_sessions`;
- cookie so deve ser emitido pela aplicacao depois da criacao persistente da sessao;
- logout grava `revoked_at`;
- sessao revogada e recusada imediatamente.

13. Validar revogacao:

```sql
select * from auth_revoke_profile_sessions('<PROFILE_ID_FICTICIO>'::uuid, 'TEST_REVOCATION', now());
```

14. Validar limpeza:

```sql
select * from auth_cleanup_security_state(now(), 86400, 604800, 2592000, 31536000);
```

15. Validar ciclos historicos de bloqueio:

- criar bloqueio;
- avancar `p_now` para depois de `blocked_until`;
- registrar nova sequencia de falhas;
- confirmar que a linha antiga recebeu `lifted_at` e `lifted_reason = 'EXPIRED'`;
- confirmar que o novo ciclo gerou nova linha;
- confirmar que nao existem dois bloqueios ativos simultaneos para o mesmo escopo/fingerprint.

16. Aplicar seed ficticio somente se o projeto de desenvolvimento estiver confirmado pelo checklist:

```powershell
supabase db seed
```

17. Gerar tipos TypeScript depois da aplicacao:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run supabase:types:dev
```

## Pendencias obrigatorias antes de producao

- Executar a validacao pratica em PostgreSQL/Supabase isolado.
- Revisar qualquer vulnerabilidade reportada pela cadeia da Supabase CLI local antes de adotar em CI.
- Definir processo formal de descarte do projeto de teste pelo painel Supabase.
- Confirmar grants e RLS diretamente no banco aplicado, nao apenas por testes estaticos.
