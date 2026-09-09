' V-Share Silent Background Runner
' Launches V-Share silently on Windows without opening any black command window.
' Receives files directly into your PC's folder even with NO browser open!

Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = ScriptDir
WshShell.Run "cmd /c node server.js", 0, False
