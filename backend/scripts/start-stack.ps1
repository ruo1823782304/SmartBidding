param(
  [ValidateSet("auto", "local", "docker")]
  [string]$Mode = "auto",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$backendRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $backendRoot ".run"
$pidRoot = Join-Path $runRoot "pids"
$logRoot = Join-Path $runRoot "logs"
$minioRoot = Join-Path $backendRoot "tools\\minio"
$minioExe = Join-Path $minioRoot "minio.exe"
$minioData = Join-Path $backendRoot "local-storage\\minio-data"
$nodeExe = (Get-Command node).Source
$npmExe = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
$localPrismaExe = Join-Path $backendRoot "node_modules\\.bin\\prisma.cmd"
$minioDownloadUrl = "https://dl.min.io/server/minio/release/windows-amd64/minio.exe"

New-Item -ItemType Directory -Force $pidRoot, $logRoot, $minioRoot, $minioData | Out-Null

function Test-PortListening {
  param([int]$Port)

  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($listener) {
    return $true
  }

  $netstat = cmd /c "netstat -ano | findstr LISTENING | findstr :$Port"
  return -not [string]::IsNullOrWhiteSpace($netstat)
}

function Start-ServiceIfPresent {
  param([string]$Name)

  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $service) {
    return $false
  }

  if ($service.Status -ne "Running") {
    Start-Service -Name $Name
  }

  return $true
}

function Wait-Port {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 30
  )

  for ($i = 0; $i -lt $TimeoutSeconds; $i += 1) {
    if (Test-PortListening -Port $Port) {
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "Port $Port did not become ready in time."
}

function Start-LocalMinio {
  if (-not (Test-Path $minioExe)) {
    Write-Host "Downloading MinIO..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $minioDownloadUrl -OutFile $minioExe
  }

  if (Test-PortListening -Port 9000) {
    Write-Host "MinIO already listening on 9000." -ForegroundColor Yellow
    return
  }

  $stdout = Join-Path $logRoot "minio.out.log"
  $stderr = Join-Path $logRoot "minio.err.log"
  $process = Start-Process -FilePath $minioExe `
    -ArgumentList @("server", $minioData, "--address", ":9000", "--console-address", ":9001") `
    -WorkingDirectory $minioRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

  Set-Content -Path (Join-Path $pidRoot "minio.pid") -Value $process.Id
  Wait-Port -Port 9000
  Wait-Port -Port 9001
}

function Start-BackendRuntime {
  if (-not $SkipBuild) {
    Push-Location $backendRoot
    try {
      if (Test-Path $localPrismaExe) {
        & $localPrismaExe migrate deploy
      } else {
        cmd /c "cd /d $backendRoot && npx prisma migrate deploy"
      }
      if ($LASTEXITCODE -ne 0) {
        throw "Prisma migrate deploy failed."
      }

      if ($npmExe) {
        & $npmExe run build
      } else {
        cmd /c "cd /d $backendRoot && npm run build"
      }
      if ($LASTEXITCODE -ne 0) {
        throw "Backend build failed."
      }
    } finally {
      Pop-Location
    }
  }

  if (Test-PortListening -Port 3001) {
    Write-Host "Backend already listening on 3001." -ForegroundColor Yellow
    return
  }

  $stdout = Join-Path $logRoot "backend.out.log"
  $stderr = Join-Path $logRoot "backend.err.log"
  $env:PORT = "3001"
  $process = Start-Process -FilePath $nodeExe `
    -ArgumentList "dist\\src\\main.js" `
    -WorkingDirectory $backendRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

  Set-Content -Path (Join-Path $pidRoot "backend.pid") -Value $process.Id
  Wait-Port -Port 3001
}

function Start-DockerInfra {
  param([string[]]$Services)

  if (-not $Services -or $Services.Count -eq 0) {
    return
  }

  $serviceArgs = $Services -join ' '
  cmd /c "docker compose up -d $serviceArgs"
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed."
  }
}

$dockerAvailable = [bool](Get-Command docker -ErrorAction SilentlyContinue)

switch ($Mode) {
  "docker" {
    if (-not $dockerAvailable) {
      throw "Docker is not installed or not in PATH."
    }
    if (Test-PortListening -Port 5432) {
      Start-DockerInfra -Services @("redis", "minio")
    } else {
      Start-DockerInfra -Services @("db", "redis", "minio")
    }
  }
  "auto" {
    $postgresStarted = Start-ServiceIfPresent -Name "postgresql-x64-18"
    $redisStarted = Start-ServiceIfPresent -Name "Redis"

    if ($postgresStarted -or (Test-PortListening -Port 5432)) {
      Wait-Port -Port 5432
    } elseif ($dockerAvailable) {
      Start-DockerInfra -Services @("db")
    } else {
      throw "PostgreSQL is not available locally and Docker is not installed."
    }

    if ($redisStarted -or (Test-PortListening -Port 6379)) {
      Wait-Port -Port 6379
    } elseif ($dockerAvailable) {
      Start-DockerInfra -Services @("redis")
    } else {
      throw "Redis is not available locally and Docker is not installed."
    }

    if ($dockerAvailable) {
      Start-DockerInfra -Services @("minio")
    } else {
      Start-LocalMinio
    }
  }
  "local" {
    Start-ServiceIfPresent -Name "postgresql-x64-18" | Out-Null
    Start-ServiceIfPresent -Name "Redis" | Out-Null
    Wait-Port -Port 5432
    Wait-Port -Port 6379
    Start-LocalMinio
  }
}

Start-BackendRuntime

Write-Host ""
Write-Host "Stack is ready:" -ForegroundColor Green
Write-Host "  Backend: http://127.0.0.1:3001/api"
Write-Host "  PostgreSQL: localhost:5432"
Write-Host "  Redis: localhost:6379"
Write-Host "  MinIO API: http://127.0.0.1:9000"
Write-Host "  MinIO Console: http://127.0.0.1:9001"
