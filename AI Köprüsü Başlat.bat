@echo off
chcp 65001 >nul
title Masa AI Koprusu
cd /d "%~dp0"
py -3 ai_kopru.py
if errorlevel 1 python ai_kopru.py
pause
