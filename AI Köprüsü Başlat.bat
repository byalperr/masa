@echo off
chcp 65001 >nul
title Masa AI Koprusu
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 ai_kopru.py
  goto :son
)
where python >nul 2>nul
if not errorlevel 1 (
  python ai_kopru.py
  goto :son
)
echo Python bulunamadi. Once Masa klasorundeki "Kurulum.bat" dosyasini calistir.
:son
pause
