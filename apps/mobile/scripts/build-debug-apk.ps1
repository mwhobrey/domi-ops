# Build Domi Ops Capacitor debug APK (Windows).
# Requires: mise java@21, Android SDK at %LOCALAPPDATA%\Android\Sdk
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$jdk = (mise where java@21).Trim()
if (-not (Test-Path "$jdk\bin\java.exe")) {
  Write-Error "JDK 21 missing. Run: mise install java@21"
}
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

$props = Join-Path $root "android\local.properties"
if (-not (Test-Path $props)) {
  # Gradle properties: C:\foo → C\:\\foo
  $sdkProp = ($env:ANDROID_HOME.Replace('\', '\\')).Replace(':', '\:')
  Set-Content -Path $props -Value "sdk.dir=$sdkProp" -Encoding ASCII
  Write-Host "Wrote $props"
}

npx cap sync android
Set-Location (Join-Path $root "android")
.\gradlew.bat :app:assembleDebug
$apk = Join-Path (Get-Location) "app\build\outputs\apk\debug\app-debug.apk"
Write-Host "APK: $apk"
