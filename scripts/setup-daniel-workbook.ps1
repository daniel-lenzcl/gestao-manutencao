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
      [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
    }
  }

$required = @("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    throw "Preencha $name no arquivo .env.supabase."
  }
}

& $nodeExecutable (Join-Path $PSScriptRoot "build-daniel-workbook-import.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "A preparacao dos dados da planilha falhou."
}

& $nodeExecutable (Join-Path $PSScriptRoot "import-daniel-workbook.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "A importacao para o Supabase falhou."
}

Write-Host ""
Write-Host "Banco da planilha migrado com sucesso." -ForegroundColor Green
