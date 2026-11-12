@echo off
chcp 65001 >nul
title AI Trading Intelligence Office - MetaTrader 5
cd /d "%~dp0"
echo.
echo  AI TRADING INTELLIGENCE OFFICE (somente analise - nao abre ordens)
echo  Deixe o MetaTrader 5 ABERTO e logado antes de continuar.
echo.
echo  Procurando uma versao do Python compativel com o MetaTrader 5...

set "PY="
rem O pacote MetaTrader5 so existe para algumas versoes do Python (64 bits).
for %%V in (3.13 3.12 3.11 3.10) do (
  if not defined PY (
    py -%%V-64 -c "import sys" >nul 2>nul && (
      py -%%V-64 -m pip install --quiet --disable-pip-version-check MetaTrader5 >nul 2>nul && set "PY=py -%%V-64"
    )
  )
)
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
  "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" -m pip install --quiet --disable-pip-version-check MetaTrader5 >nul 2>nul && set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)

if not defined PY (
  echo.
  echo  Nenhuma versao compativel encontrada. Instalando o Python 3.12 automaticamente...
  echo  (pode demorar alguns minutos; aceite se o Windows pedir permissao)
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" -m pip install --quiet --disable-pip-version-check MetaTrader5 && set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
  )
)

if not defined PY (
  echo.
  echo  [!] Nao consegui preparar o Python automaticamente.
  echo      Instale o Python 3.12 ^(64 bits^) por este link e rode este arquivo de novo:
  echo      https://www.python.org/downloads/release/python-3128/
  echo      ^(escolha "Windows installer 64-bit" e marque "Add python.exe to PATH"^)
  pause
  exit /b 1
)

echo  Usando: %PY%
echo  O painel abre sozinho no navegador assim que estiver pronto.
echo  Baixando o calendario economico da semana...
%PY% -m tio news --fetch >nul 2>nul
echo  Treino automatico: 8 pares em M1, M5 e M15 (operacoes apenas simuladas).
set OPEN=--open
:inicio
%PY% -X faulthandler -m tio --provider mt5 --tf M5 --tfs M1,M5,M15 serve --auto %OPEN%
echo.
echo  [!] O escritorio parou. Se repetir, tire uma foto desta janela (o erro aparece acima) e envie.
echo      Reiniciando em 10 segundos... (feche esta janela para encerrar)
set OPEN=
timeout /t 10 >nul
goto inicio
