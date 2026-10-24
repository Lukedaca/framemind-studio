param([switch]$Hd, [switch]$Installed, [switch]$Quick, [switch]$ModelCheck)
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$exePath = if ($Installed) { Join-Path $env:LOCALAPPDATA 'FrameMind Studio\framemind-studio.exe' }
  else { Join-Path $repoPath 'src-tauri\target\release\framemind-studio.exe' }
if (Get-Process -Name framemind-studio -ErrorAction SilentlyContinue) { throw 'Studio is running; preserve its work.' }
if (Get-NetTCPConnection -State Listen -LocalPort 9225 -ErrorAction SilentlyContinue) { throw 'Diagnostic port is occupied.' }
$outputPath = Join-Path $repoPath 'output\playwright\retouch-adaptive'
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$normalProfile = Join-Path $env:LOCALAPPDATA 'cz.framemind.studio'
function Read-WorkspaceHashes {
  @(Get-ChildItem -LiteralPath $normalProfile -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object FullName -Match '\\(IndexedDB|Local Storage)\\' |
    Sort-Object FullName |
    ForEach-Object { @{ path = $_.FullName; hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } })
}
$before = @(Read-WorkspaceHashes)
$profilePath = Join-Path $outputPath ('native-profile-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profilePath | Out-Null
$app = $null
$smoke = $null
try {
  $env:WEBVIEW2_USER_DATA_FOLDER = $profilePath
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1'
  $app = Start-Process -FilePath $exePath -WorkingDirectory $repoPath -WindowStyle Hidden -PassThru
  Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER,Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { Invoke-RestMethod 'http://127.0.0.1:9225/json/version' -TimeoutSec 1 | Out-Null; $ready = $true; break }
    catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $ready) { throw 'Native diagnostic port did not open.' }
  $isolated = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profilePath) })
  if (-not $isolated.Count) { throw 'Separate test profile was not confirmed; refusing automation.' }
  $env:DESKTOP_SMOKE_CDP = 'http://127.0.0.1:9225'
  $arguments = @('scripts/retouch-adaptive-smoke.mjs')
  if ($Hd) { $arguments += '--hd' }
  if ($Quick) { $arguments += '--quick' }
  if ($ModelCheck) { $arguments += '--model-check' }
  $stdout = Join-Path $outputPath 'native.log'
  $stderr = Join-Path $outputPath 'native.err'
  $smoke = Start-Process -FilePath (Get-Command node).Source -ArgumentList $arguments -WorkingDirectory $repoPath -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $null = $smoke.Handle
  $timer = [Diagnostics.Stopwatch]::StartNew()
  while (-not $smoke.WaitForExit(1000)) {
    if ($timer.Elapsed.TotalSeconds -gt $(if ($Hd) { 540 } else { 300 })) { Stop-Process -Id $smoke.Id; throw 'Native retouch exceeded its time limit.' }
  }
  $smoke.WaitForExit()
  $smoke.Refresh()
  Get-Content -LiteralPath $stdout
  Get-Content -LiteralPath $stderr
  if ($smoke.ExitCode -ne 0) { throw "Native retouch failed: $($smoke.ExitCode)" }
} finally {
  Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER,Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,Env:DESKTOP_SMOKE_CDP,Env:EDITOR_SMOKE_URL -ErrorAction SilentlyContinue
  if ($smoke -and -not $smoke.HasExited) { Stop-Process -Id $smoke.Id }
  if ($app -and (Get-Process -Id $app.Id -ErrorAction SilentlyContinue)) { Stop-Process -Id $app.Id }
}
$after = @(Read-WorkspaceHashes)
if ($before.Count -ne $after.Count) { throw 'Normal workspace file count changed.' }
for ($i = 0; $i -lt $before.Count; $i++) {
  if ($before[$i].path -ne $after[$i].path -or $before[$i].hash -ne $after[$i].hash) { throw 'Normal workspace contents changed.' }
}
@{ nativeRetouchPassed = $true; isolatedProfile = $profilePath; normalProfileFilesUnchanged = $before.Count;
  executable = $exePath; sha256 = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'native-workspace.json') -Encoding utf8
