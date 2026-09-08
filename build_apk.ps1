# PowerShell Build Script for DropFile Android APK
$ErrorActionPreference = "Stop"

$sdkDir = "C:\Users\hp\AppData\Local\Android\Sdk"
$buildTools = "$sdkDir\build-tools\34.0.0"
$platformJar = "$sdkDir\platforms\android-34\android.jar"
$jdkBin = "C:\Program Files\Eclipse Adoptium\jdk-17.0.15.6-hotspot\bin"

$appDir = "$PSScriptRoot\android-app"
$buildDir = "$appDir\build"
$resDir = "$appDir\res"
$srcDir = "$appDir\src"
$manifest = "$appDir\AndroidManifest.xml"

Add-Type -AssemblyName System.IO.Compression.FileSystem

# Clean build directory
if (Test-Path $buildDir) { Remove-Item -Recurse -Force $buildDir }
New-Item -ItemType Directory -Path "$buildDir\res_compiled" | Out-Null
New-Item -ItemType Directory -Path "$buildDir\gen" | Out-Null
New-Item -ItemType Directory -Path "$buildDir\classes" | Out-Null

Write-Host "Step 1: Compiling resources with aapt2..."
& "$buildTools\aapt2.exe" compile --dir $resDir -o "$buildDir\res_compiled"

Write-Host "Step 2: Linking resources and generating R.java..."
$flatFiles = Get-ChildItem "$buildDir\res_compiled\*.flat" | ForEach-Object { $_.FullName }
& "$buildTools\aapt2.exe" link -I $platformJar --manifest $manifest --java "$srcDir" -o "$buildDir\app-unsigned-unaligned.apk" $flatFiles --auto-add-overlay

Write-Host "Step 3: Compiling Java sources..."
$javaFiles = Get-ChildItem -Recurse "$srcDir\*.java" | ForEach-Object { $_.FullName }
& "$jdkBin\javac.exe" -encoding UTF-8 -d "$buildDir\classes" -cp $platformJar $javaFiles

Write-Host "Step 4: Converting bytecode to DEX with d8..."
$classFiles = Get-ChildItem -Recurse "$buildDir\classes\*.class" | ForEach-Object { $_.FullName }
cmd.exe /c "$buildTools\d8.bat" --lib $platformJar --output "$buildDir" $classFiles

Write-Host "Step 5: Adding classes.dex to APK with jar..."
Copy-Item "$buildDir\app-unsigned-unaligned.apk" "$buildDir\app-unaligned.apk"
& "$jdkBin\jar.exe" -uf "$buildDir\app-unaligned.apk" -C "$buildDir" classes.dex

Write-Host "Step 6: Zipalign..."
& "$buildTools\zipalign.exe" -f -p 4 "$buildDir\app-unaligned.apk" "$buildDir\app-aligned.apk"

Write-Host "Step 7: Signing APK..."
$keystore = "$buildDir\debug.keystore"
if (-not (Test-Path $keystore)) {
    & "$jdkBin\keytool.exe" -genkeypair -keystore $keystore -storepass android -keypass android -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000
}

$outputApk = "$PSScriptRoot\public\V-Share.apk"
cmd.exe /c "$buildTools\apksigner.bat" sign --ks $keystore --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --out $outputApk "$buildDir\app-aligned.apk"
Copy-Item -Force $outputApk "$PSScriptRoot\public\DropFile.apk"

Write-Host "==============================================="
Write-Host "🎉 V-Share.apk successfully built!"
Write-Host "Saved to: $outputApk"
Write-Host "Also copied to: $PSScriptRoot\public\DropFile.apk"
Write-Host "==============================================="
