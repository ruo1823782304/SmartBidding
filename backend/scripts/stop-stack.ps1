$ErrorActionPreference = "SilentlyContinue"

$backendRoot = Split-Path -Parent $PSScriptRoot
$pidRoot = Join-Path $backendRoot ".run\\pids"
$backendPidFile = Join-Path $pidRoot "backend.pid"
$backendSupervisorPidFile = Join-Path $pidRoot "backend-supervisor.pid"
$backendStopFile = Join-Path $pidRoot "backend.stop"
$minioPidFile = Join-Path $pidRoot "minio.pid"

New-Item -ItemType File -Path $backendStopFile -Force | Out-Null

foreach ($pidFile in @($backendPidFile, $backendSupervisorPidFile, $minioPidFile)) {
  if (Test-Path $pidFile) {
    $pid = Get-Content -LiteralPath $pidFile | Select-Object -First 1
    if ($pid -and $pid -match '^\d+$') {
      Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
}

Remove-Item -LiteralPath $backendStopFile -Force -ErrorAction SilentlyContinue

Write-Host "Local backend and MinIO processes stopped."
