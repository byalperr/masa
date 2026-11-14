@echo off
chcp 65001 >nul
title Masa - Yapay Zekaya Sor kurulumu
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0araclar\kurulum.ps1"
echo.
pause
