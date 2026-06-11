$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $workspace ".env.supabase"
$nodeExecutable = @(
  "C:\Users\danie\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not (Test-Path $envFile)) {
  throw "Arquivo .env.supabase nao encontrado."
}

if (-not $nodeExecutable) {
  throw "Node.js nao encontrado neste computador."
}

Get-Content $envFile |
  Where-Object { $_ -and -not $_.StartsWith("#") } |
  ForEach-Object {
    $name, $value = $_ -split "=", 2
    if ($name -and $value) {
      Set-Item -Path "Env:$name" -Value $value
    }
  }

$required = @(
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
)

foreach ($name in $required) {
  if (-not (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value) {
    throw "Preencha $name no arquivo .env.supabase."
  }
}

& $nodeExecutable (Join-Path $PSScriptRoot "create-demo-users.mjs")

if ($LASTEXITCODE -ne 0) {
  throw "A criacao dos dados de demonstracao falhou."
}

Write-Host ""
Write-Host "Usuarios, modelos e edificacoes de demonstracao criados com sucesso." -ForegroundColor Green
