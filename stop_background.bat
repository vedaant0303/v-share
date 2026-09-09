@echo off
title Stop V-Share Background Service
echo Stopping background V-Share server...
taskkill /F /IM node.exe >nul 2>nul
echo V-Share stopped.
timeout /t 2 >nul
