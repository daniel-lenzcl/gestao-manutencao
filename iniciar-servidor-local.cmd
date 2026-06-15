@echo off
chcp 65001 >nul
title Servidor local - Gestao de Manutencao
cd /d "%~dp0"

set "PYTHON=C:\Users\danie\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if not exist "%PYTHON%" (
  echo Python do projeto nao foi encontrado.
  echo Caminho esperado:
  echo %PYTHON%
  pause
  exit /b 1
)

echo.
echo Servidor local iniciado.
echo Computador: http://localhost:4173
echo.
echo Mantenha esta janela aberta. Para encerrar, pressione Ctrl+C.
echo.

"%PYTHON%" -m http.server 4173 --bind 0.0.0.0 --directory "%~dp0docs"

echo.
echo O servidor foi encerrado.
pause
