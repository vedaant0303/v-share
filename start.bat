@echo off
title V-Share - Mobile to PC Transfer
color 0B

echo ========================================================
echo               ⚡ V-Share Launcher ⚡
echo     Local Wi-Fi File Transfer: Mobile to PC
echo ========================================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b
)

:: Check if node_modules exists
if not exist node_modules (
    echo [INFO] First time setup: Installing required packages...
    call npm install
    echo.
)

echo [INFO] Starting V-Share server...
start "" "http://localhost:4000"
node server.js

pause
