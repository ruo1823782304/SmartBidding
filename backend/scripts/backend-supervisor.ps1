param(
  [Parameter(Mandatory = $true)]
  [string]$BackendRoot,
  [Parameter(Mandatory = $true)]
  [string]$NodeExe,
  [Parameter(Mandatory = $true)]
  [string]$PidRoot,
  [Parameter(Mandatory = $true)]
  [string]$LogRoot,
  [int]$Port = 3001
)

$ErrorActionPreference = "Continue"

$backendPidFile = Join-Path $PidRoot "backend.pid"
$stopFile = Join-Path $PidRoot "backend.stop"
$stdoutLog = Join-Path $LogRoot "backend.out.log"
$stderrLog = Join-Path $LogRoot "backend.err.log"
$supervisorLog = Join-Path $LogRoot "backend.supervisor.log"

New-Item -ItemType Directory -Force $PidRoot, $LogRoot | Out-Null

function Write-SupervisorLog {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $supervisorLog -Value "[$timestamp] $Message" -Encoding utf8
}

function Archive-RunLogs {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"

  foreach ($entry in @(
    @{ Source = $stdoutLog; Target = (Join-Path $LogRoot "backend.out.$stamp.log") },
    @{ Source = $stderrLog; Target = (Join-Path $LogRoot "backend.err.$stamp.log") }
  )) {
    if (Test-Path $entry.Source) {
      $item = Get-Item -LiteralPath $entry.Source
      if ($item.Length -gt 0) {
        Copy-Item -LiteralPath $entry.Source -Destination $entry.Target -Force
      }
    }
  }
}

Write-SupervisorLog "Backend supervisor started. port=$Port"

while ($true) {
  if (Test-Path $stopFile) {
    Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
    Write-SupervisorLog "Stop flag detected before launch. Supervisor exiting."
    break
  }

  if (Test-Path $backendPidFile) {
    Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue
  }

  $env:PORT = "$Port"
  Write-SupervisorLog "Launching backend process."

  try {
    $process = Start-Process -FilePath $NodeExe `
      -ArgumentList "dist\\src\\main.js" `
      -WorkingDirectory $BackendRoot `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -PassThru
  } catch {
    Write-SupervisorLog "Failed to launch backend process: $($_.Exception.Message)"
    break
  }

  Set-Content -LiteralPath $backendPidFile -Value $process.Id -Encoding utf8
  Write-SupervisorLog "Backend process started with pid=$($process.Id)."

  try {
    $process.WaitForExit()
  } catch {
    Write-SupervisorLog "WaitForExit failed for pid=$($process.Id): $($_.Exception.Message)"
  }

  $exitCode = $process.ExitCode
  Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue
  Write-SupervisorLog "Backend process exited. pid=$($process.Id), exitCode=$exitCode"
  Archive-RunLogs

  if (Test-Path $stopFile) {
    Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
    Write-SupervisorLog "Stop flag detected after child exit. Supervisor exiting."
    break
  }

  Write-SupervisorLog "Unexpected backend exit detected. Restarting in 2 seconds."
  Start-Sleep -Seconds 2
}

Write-SupervisorLog "Backend supervisor stopped."
