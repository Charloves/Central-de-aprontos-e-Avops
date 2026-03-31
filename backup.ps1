param(
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git nao encontrado no PATH."
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$status = git status --porcelain
if (-not $status) {
    Write-Host "Nenhuma alteracao para salvar."
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "backup: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
}

git add .
git commit -m $Message

Write-Host "Backup Git criado com sucesso:"
Write-Host $Message
Write-Host ""
Write-Host "Se houver um remoto configurado, voce pode enviar com:"
Write-Host "git push -u origin main"
