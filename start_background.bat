@echo off
title V-Share Background Starter
start "" wscript.exe "%~dp0V-Share-Background.vbs"
echo V-Share is now running silently in the background!
echo Files dropped from mobile will save directly to your PC folder with NO browser open.
timeout /t 3 >nul
