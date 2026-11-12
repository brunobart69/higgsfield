@echo off
chcp 65001 >nul
title Diagnostico do MetaTrader 5
cd /d "%~dp0"
echo  Deixe o MetaTrader 5 aberto e logado. Testando a leitura de velas...
set "PY="
for %%V in (3.13 3.12 3.11 3.10) do (
  if not defined PY (
    py -%%V-64 -c "import MetaTrader5" >nul 2>nul && set "PY=py -%%V-64"
  )
)
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY set PY=python
%PY% -m tio diagnostico EURUSD
%PY% -m tio diagnostico AUDCAD
echo.
echo  Tire uma foto desta janela e envie.
pause
