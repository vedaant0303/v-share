# Install V-Share as an Automatic Windows Silent Background Service
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$dropFilePath = $PSScriptRoot
$vbsPath = Join-Path $dropFilePath "V-Share-Background.vbs"
$shortcutPath = Join-Path $startupFolder "V-Share.lnk"

Write-Host "===================================================="
Write-Host "   Installing V-Share Silent Background Service"
Write-Host "===================================================="
Write-Host "V-Share Folder: $dropFilePath"
Write-Host "Startup Folder: $startupFolder"

# Create Shortcut in Windows Startup folder
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $dropFilePath
$shortcut.WindowStyle = 7
$shortcut.Description = "V-Share Silent Background Service"
$shortcut.Save()

Write-Host " Shortcut created in Windows Startup: V-Share.lnk"

# Start the background service immediately if not already running
$nodeRunning = Get-Process -Name "node" -ErrorAction SilentlyContinue
if (-not $nodeRunning) {
    Write-Host "🚀 Launching V-Share silent background engine now..."
    Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbsPath`"" -WorkingDirectory $dropFilePath
} else {
    Write-Host "✅ V-Share engine is already running in the background!"
}

# Pop up Windows confirmation notification
$notifyScript = Join-Path $dropFilePath "notify.ps1"
if (Test-Path $notifyScript) {
    & powershell -ExecutionPolicy Bypass -File $notifyScript -title "V-Share Installed! 🟢" -message "Now running silently in the background! You can close all browser tabs and windows."
}

Write-Host "===================================================="
Write-Host " SUCCESS! V-Share will now run automatically in the"
Write-Host " background every time Windows boots up."
Write-Host " You can close all tabs and windows on the taskbar!"
Write-Host "===================================================="
