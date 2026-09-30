# Arranca la web y la API en desarrollo con la IA de los PNJ (Ollama).
# Uso: .\dev-ia.ps1  o  .\dev-ia.ps1 -Model llama3.1:8b
param(
  [string]$Url = "http://localhost:11434",
  [string]$Model = "qwen2.5:7b"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

try {
  $tags = Invoke-RestMethod -Uri "$Url/api/tags" -TimeoutSec 5
} catch {
  Write-Host "No se llega a Ollama en $Url. Abre Ollama y vuelve a probar." -ForegroundColor Red
  exit 1
}

if (-not ($tags.models | Where-Object { $_.name -eq $Model })) {
  Write-Host "Falta el modelo $Model. Descargándolo..." -ForegroundColor Yellow
  ollama pull $Model
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$env:OLLAMA_URL = $Url
$env:OLLAMA_MODEL = $Model
Write-Host "IA: $Model en $Url" -ForegroundColor Green
pnpm dev
