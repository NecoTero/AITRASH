$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$Npm = "C:\Program Files\nodejs\npm.cmd"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"

if (-not (Test-Path $Docker)) { $Docker = "docker" }
if (-not (Test-Path $Npm)) { $Npm = "npm" }
if (-not (Test-Path $Python)) { throw "Backend venv not found: $Python" }

$env:PATH = "C:\Program Files\nodejs;" + $env:PATH

Push-Location $Root
try {
  & $Docker compose up -d postgres
} finally {
  Pop-Location
}

$BackendLog = Join-Path $Root "backend.log"
$BackendErr = Join-Path $Root "backend.err.log"
$FrontendLog = Join-Path $Root "frontend.log"
$FrontendErr = Join-Path $Root "frontend.err.log"
Remove-Item -LiteralPath $BackendLog, $BackendErr, $FrontendLog, $FrontendErr -ErrorAction SilentlyContinue

Start-Process -FilePath $Python `
  -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000") `
  -WorkingDirectory $Backend `
  -WindowStyle Hidden `
  -RedirectStandardOutput $BackendLog `
  -RedirectStandardError $BackendErr

Start-Process -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "`$env:PATH = 'C:\Program Files\nodejs;' + `$env:PATH; & '$Npm' run dev -- --host 127.0.0.1") `
  -WorkingDirectory $Frontend `
  -WindowStyle Hidden `
  -RedirectStandardOutput $FrontendLog `
  -RedirectStandardError $FrontendErr

Start-Sleep -Seconds 3

Write-Host "TimeLiner started:"
Write-Host "  Frontend: http://127.0.0.1:5173"
Write-Host "  Backend:  http://127.0.0.1:8000/api/health"
Write-Host "Logs:"
Write-Host "  $FrontendLog"
Write-Host "  $BackendErr"

