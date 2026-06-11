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

& $nodeExecutable (Join-Path $PSScriptRoot "build-daniel-import.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao preparar os dados da planilha."
}

& $nodeExecutable (Join-Path $PSScriptRoot "import-daniel-workbook.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao importar os dados para o Supabase."
}

Write-Host ""
Write-Host "Migracao da planilha concluida." -ForegroundColor Green
