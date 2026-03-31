$ErrorActionPreference = "SilentlyContinue"

$backendRoot = Split-Path -Parent $PSScriptRoot
$pidRoot = Join-Path $backendRoot ".run\\pids"

foreach ($name in @("backend", "minio")) {
  $pidFile = Join-Path $pidRoot "$name.pid"
  if (Test-Path $pidFile) {
    $pid = Get-Content $pidFile | Select-Object -First 1
    if ($pid) {
      Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Local backend and MinIO processes stopped."
