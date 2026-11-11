@echo off
chcp 65001 >nul
title AI Trading Intelligence Office - MetaTrader 5
cd /d "%~dp0"
echo.
echo  AI TRADING INTELLIGENCE OFFICE (somente analise - nao abre ordens)
echo  Deixe o MetaTrader 5 ABERTO e logado antes de continuar.
echo.
where python >nul 2>nul
if errorlevel 1 (
  echo  [!] Python nao encontrado. Instale em https://www.python.org/downloads/
  echo      e marque a opcao "Add python.exe to PATH" na instalacao.
  pause
  exit /b 1
)
python -m pip install --quiet --disable-pip-version-check MetaTrader5
start "" /min cmd /c "timeout /t 5 >nul & start http://127.0.0.1:8765"
python -m tio --provider mt5 serve
pause
