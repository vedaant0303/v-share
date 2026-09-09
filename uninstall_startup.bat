@echo off
title Uninstalling V-Share Startup Service...
powershell -Command "$startup = [System.Environment]::GetFolderPath('Startup'); $link = Join-Path $startup 'V-Share.lnk'; if (Test-Path $link) { Remove-Item -Force $link; Write-Host 'Removed V-Share from Windows Startup.' } else { Write-Host 'V-Share was not in Startup.' }; Stop-Process -Name 'node' -ErrorAction SilentlyContinue; Write-Host 'Stopped V-Share background process.'"
echo.
echo V-Share Startup service removed.
pause
