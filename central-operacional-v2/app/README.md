# Central Operacional V2

Aplicação web independente de Google Apps Script para AVOPs, Aprontos e OI.

## Estado atual

Esta pasta contém a base inicial da V2:

- Next.js com TypeScript.
- Modelo SQL para Supabase/PostgreSQL.
- Regras puras para normalização, cobrança, OI e transferência de admin.
- Estrutura inicial de UI.
- Testes unitários das regras críticas.

## Decisões já aplicadas

- `CHA` é o coordenador/admin inicial.
- Cobrança de AVOP: semanal nos primeiros 30 dias; mensal após o 31º dia; encerra em 365 dias ou quando a pendência deixa de existir.
- Auditoria histórica preserva registros antigos sem recálculo retroativo; quando faltar evidência do perfil vigente, deve registrar `perfil histórico não disponível`. A partir da V2, publicações terão snapshot de público/perfil aplicável.
- PDFs permanecem no Google Drive.
- E-mail funcional: `cdout.1gav11@gmail.com`.

## Primeiros comandos

```powershell
cd "C:\Users\Charles Angelo\OneDrive\Documentos\Google AppScript\Central Operacional\central-operacional-v2\app"
npm install
npm run test
npm run typecheck
npm run dev
```

No Supabase, aplique primeiro `supabase/migrations/0001_initial_schema.sql` e depois `supabase/seed.sql`.

## Ambientes

Copie `.env.example` para um arquivo local de ambiente e preencha credenciais reais somente fora do Git:

- `.env.development.local`
- `.env.homologation.local`
- `.env.production.local`

Nenhum segredo deve ser commitado.
