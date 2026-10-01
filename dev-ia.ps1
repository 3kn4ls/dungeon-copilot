# Arranca la web y la API en desarrollo con la IA de los PNJ (Ollama).
# Uso: .\dev-ia.ps1  o  .\dev-ia.ps1 -Model llama3.1:8b
# Con las sugerencias de Nimble: .\dev-ia.ps1 -DecisionModel nimble (Ollama 0.35 o posterior).
# Solo con ellas: .\dev-ia.ps1 -Model "" -DecisionModel nimble
param(
  [string]$Url = "http://localhost:11434",
  [string]$Model = "qwen2.5:7b",
  [string]$DecisionModel = ""
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

try {
  $tags = Invoke-RestMethod -Uri "$Url/api/tags" -TimeoutSec 5
} catch {
  Write-Host "No se llega a Ollama en $Url. Abre Ollama y vuelve a probar." -ForegroundColor Red
  exit 1
}

# Descarga el modelo si falta. "nimble" es "nimble:latest" en la lista de Ollama.
function Get-Model([string]$Name) {
  if ($tags.models | Where-Object { $_.name -eq $Name -or $_.name -eq "${Name}:latest" }) { return }
  Write-Host "Falta el modelo $Name. Descargándolo..." -ForegroundColor Yellow
  ollama pull $Name
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not $Model -and -not $DecisionModel) {
  Write-Host "Elige al menos un modelo: -Model o -DecisionModel." -ForegroundColor Red
  exit 1
}

$env:OLLAMA_URL = $Url
if ($Model) {
  Get-Model $Model
  $env:OLLAMA_MODEL = $Model
  Write-Host "IA: $Model en $Url" -ForegroundColor Green
} else {
  Remove-Item Env:OLLAMA_MODEL -ErrorAction SilentlyContinue
}

if ($DecisionModel) {
  $version = (Invoke-RestMethod -Uri "$Url/api/version" -TimeoutSec 5).version
  if ([version]($version -replace '[^0-9.].*$', '') -lt [version]"0.35") {
    Write-Host "Las sugerencias necesitan Ollama 0.35 o posterior, y tienes la $version. Actualízalo." -ForegroundColor Red
    exit 1
  }
  Get-Model $DecisionModel
  $env:OLLAMA_DECISION_MODEL = $DecisionModel
  Write-Host "Sugerencias: $DecisionModel en $Url" -ForegroundColor Green
} else {
  Remove-Item Env:OLLAMA_DECISION_MODEL -ErrorAction SilentlyContinue
}

pnpm dev
