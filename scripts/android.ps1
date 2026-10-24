# Android build helper for Windows: sets the SDK / NDK / Java environment and runs a Tauri Android command.
#   powershell -File scripts/android.ps1 build --debug --apk --target aarch64
#   powershell -File scripts/android.ps1 dev
# Defaults: the SDK from Android Studio (%LOCALAPPDATA%\Android\Sdk), the newest NDK in it, Android Studio's bundled JBR.
$ErrorActionPreference = "Stop"
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not (Test-Path $sdk)) { throw "Android SDK not found: $sdk (install it with Android Studio)" }
$env:ANDROID_HOME = $sdk
if (-not $env:NDK_HOME) {
    $ndk = Get-ChildItem (Join-Path $sdk "ndk") -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]$_.Name } | Select-Object -Last 1
    if (-not $ndk) { throw "No NDK in $sdk\ndk (SDK Manager -> SDK Tools -> NDK (Side by side))" }
    $env:NDK_HOME = $ndk.FullName
}
if (-not $env:JAVA_HOME) {
    $jbr = Join-Path $env:LOCALAPPDATA "Programs\Android Studio\jbr"
    if (-not (Test-Path $jbr)) { $jbr = "C:\Program Files\Android\Android Studio\jbr" }
    $env:JAVA_HOME = $jbr
}
# Java creates a Unix-domain socket for its selector wakeup in the temp folder; a short 8.3 TEMP path
# (C:\Users\NAME~1.X\...) makes it fail with "Unable to establish loopback connection", so use a plain folder.
$jtmp = Join-Path $env:USERPROFILE ".jtmp"
New-Item -ItemType Directory -Force $jtmp | Out-Null
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$jtmp"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
Write-Host "NDK_HOME=$env:NDK_HOME"
Write-Host "JAVA_HOME=$env:JAVA_HOME"
Set-Location (Join-Path $PSScriptRoot "..")
pnpm tauri android @args
exit $LASTEXITCODE
