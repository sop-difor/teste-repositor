@echo off
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="" (
  echo.
  echo   Arraste a planilha do SINAPI ^(.xlsx^) para cima deste arquivo.
  echo.
  pause
  exit /b
)

echo Gerando CSV a partir de: %~nx1
echo.
python "gerar_stg_sinapi.py" "%~1"
set ERR=%ERRORLEVEL%
echo.

if %ERR%==0 (
  echo Pronto. Abrindo a pasta com o CSV...
  explorer "%~dp0"
) else (
  echo Deu erro ^(codigo %ERR%^). Veja as mensagens acima.
)
echo.
pause
