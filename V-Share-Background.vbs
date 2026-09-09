' V-Share Silent Background Runner
' This launches V-Share in the background without any command prompt window.
' Files sent from mobile will be saved directly into your PC's folder even when no browser is open!

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c node server.js", 0, False
