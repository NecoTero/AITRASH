[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RunId,

    [ValidateRange(1, 50)]
    [int]$BatchSize = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Utf8Text {
    param([string]$Path, [string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Append-Utf8Text {
    param([string]$Path, [string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::AppendAllText($Path, $Text, $encoding)
}

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$diagnosticsRoot = Join-Path $workspace "09_outputs\_diagnostics\full_$RunId"
$manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
$progressPath = Join-Path $diagnosticsRoot 'preflight_progress.json'
$logPath = Join-Path $diagnosticsRoot 'preflight_orchestrator.log'
$analyzerPath = Join-Path $PSScriptRoot 'analyze_full_mkd2.ps1'

foreach ($required in @($manifestPath, $analyzerPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Не найден обязательный файл: $required"
    }
}

$illustratorProcess = Get-Process Illustrator -ErrorAction Stop |
    Select-Object -First 1
$initialPid = $illustratorProcess.Id
$startedAt = (Get-Date).ToString('s')
$batches = 0

Write-Utf8Text -Path $logPath -Text (
    "[$startedAt] START run_id=$RunId pid=$initialPid batch_size=$BatchSize`r`n"
)

try {
    while ($true) {
        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        $pending = @(
            $manifestRows |
                Where-Object {
                    -not $_.PSObject.Properties['preflight_status'] -or
                    $_.preflight_status -ne 'OK'
                }
        )
        $errors = @(
            $manifestRows |
                Where-Object {
                    $_.PSObject.Properties['preflight_status'] -and
                    $_.preflight_status -and
                    $_.preflight_status -ne 'OK'
                }
        )
        if ($pending.Count -eq 0) {
            break
        }
        if ($errors.Count -gt 0) {
            throw "Preflight содержит $($errors.Count) ERROR; автоматическое продолжение остановлено."
        }

        $startIndex = [int](
            $pending |
                Sort-Object { [int]$_.index } |
                Select-Object -First 1
        ).index
        $batchResult = & $analyzerPath `
            -RunId $RunId `
            -StartIndex $startIndex `
            -MaxFiles $BatchSize
        $batches += 1

        $currentProcess = Get-Process Illustrator -ErrorAction Stop |
            Select-Object -First 1
        if ($currentProcess.Id -ne $initialPid) {
            throw "PID Illustrator изменился: $initialPid -> $($currentProcess.Id)"
        }
        if (-not $currentProcess.Responding) {
            throw "Illustrator PID $initialPid не отвечает."
        }

        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        $okCount = @(
            $manifestRows |
                Where-Object {
                    $_.PSObject.Properties['preflight_status'] -and
                    $_.preflight_status -eq 'OK'
                }
        ).Count
        $pendingCount = 388 - $okCount
        $timestamp = (Get-Date).ToString('s')
        Append-Utf8Text -Path $logPath -Text (
            "[$timestamp] BATCH=$batches ok=$okCount pending=$pendingCount " +
            "pid=$initialPid`r`n"
        )
        Write-Utf8Text -Path $progressPath -Text (
            [ordered]@{
                schema_version = 1
                run_id = $RunId
                status = 'running'
                started_at = $startedAt
                updated_at = $timestamp
                illustrator_pid = $initialPid
                batches = $batches
                analyzed_ok = $okCount
                pending = $pendingCount
                error = ''
            } | ConvertTo-Json -Depth 4
        )
    }

    $preflightSummaryPath = Join-Path $diagnosticsRoot 'preflight_summary.json'
    $preflightSummary = Get-Content -LiteralPath $preflightSummaryPath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $preflightSummary.accepted_distribution) {
        throw "Распределение масштабов не прошло контрольную приёмку."
    }

    $completedAt = (Get-Date).ToString('s')
    Write-Utf8Text -Path $progressPath -Text (
        [ordered]@{
            schema_version = 1
            run_id = $RunId
            status = 'completed'
            started_at = $startedAt
            updated_at = $completedAt
            illustrator_pid = $initialPid
            batches = $batches
            analyzed_ok = 388
            pending = 0
            error = ''
        } | ConvertTo-Json -Depth 4
    )
    Append-Utf8Text -Path $logPath -Text (
        "[$completedAt] COMPLETE analyzed_ok=388 pid=$initialPid`r`n"
    )
} catch {
    $failedAt = (Get-Date).ToString('s')
    Write-Utf8Text -Path $progressPath -Text (
        [ordered]@{
            schema_version = 1
            run_id = $RunId
            status = 'error'
            started_at = $startedAt
            updated_at = $failedAt
            illustrator_pid = $initialPid
            batches = $batches
            analyzed_ok = 0
            pending = 0
            error = $_.Exception.Message
        } | ConvertTo-Json -Depth 4
    )
    Append-Utf8Text -Path $logPath -Text (
        "[$failedAt] ERROR $($_.Exception.Message)`r`n"
    )
    throw
}
