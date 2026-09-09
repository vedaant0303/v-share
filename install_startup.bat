@echo off
title Installing V-Share Background Service...
powershell -ExecutionPolicy Bypass -File "%~dp0install_startup.ps1"
pause
