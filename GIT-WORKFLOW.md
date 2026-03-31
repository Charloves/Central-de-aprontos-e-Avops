# Git para Apps Script

Este projeto esta preparado para usar Git como historico de desenvolvimento.

## O que esta configurado

- `.gitignore`: evita versionar credenciais locais e lixo de sistema.
- `backup.ps1`: cria um commit rapido com data e hora.

## Backup rapido

No PowerShell, dentro desta pasta:

```powershell
.\backup.ps1
```

Ou com uma mensagem sua:

```powershell
.\backup.ps1 -Message "ajusta menu principal"
```

## Fluxo recomendado

1. Rode `clasp pull` antes de começar, se houve mudanca online.
2. Edite os arquivos localmente no VS Code.
3. Rode `.\backup.ps1` varias vezes durante o trabalho.
4. Quando quiser mandar para o Apps Script, rode `clasp push`.

## Para ter backup de verdade fora do computador

Git local protege o historico na maquina.
Para backup externo, conecte este repositorio a GitHub, GitLab ou outro remoto:

```powershell
git remote add origin <URL_DO_REPOSITORIO>
git push -u origin main
```

## Base para projetos futuros

Para um novo projeto Apps Script, copie estes arquivos:

- `.gitignore`
- `backup.ps1`
- `GIT-WORKFLOW.md`

Depois rode:

```powershell
git init -b main
git add .
git commit -m "chore: estrutura inicial"
```
