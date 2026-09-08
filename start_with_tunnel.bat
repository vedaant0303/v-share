@echo off
title V-Share - Mobile to PC Transfer (Public Cloudflare Tunnel Mode)
color 0B

echo ========================================================
echo        ⚡ V-Share - Public Cloudflare Tunnel Mode ⚡
echo     Accessible from ANY device, anywhere in the world!
echo     Zero port-forwarding - Free HTTPS - Files saved to PC
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

echo [INFO] Starting V-Share server with Cloudflare Public Tunnel...
start "" "http://localhost:4000"
node server.js --tunnel

pause
