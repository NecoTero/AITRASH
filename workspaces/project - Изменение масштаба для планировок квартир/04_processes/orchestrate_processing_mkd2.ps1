[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RunId,

    [ValidateRange(1, 25)]
    [int]$BatchSize = 5,

    [ValidateRange(1, 10)]
    [int]$MaxAttempts = 3
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

function Get-StatusCounts {
    param([object[]]$Rows)
    $result = [ordered]@{}
    foreach ($status in @(
        'PENDING',
        'ERROR',
        'PROCESSED_OK',
        'VERIFY_ERROR',
        'OK',
        'SOURCE_HASH_MISMATCH'
    )) {
        $result[$status] = @($Rows | Where-Object status -eq $status).Count
    }
    return $result
}

function Test-StrictTrue {
    param([object]$Value)
    return $Value -is [bool] -and $Value
}

function Assert-SameIllustrator {
    param([int]$ExpectedPid)
    $processes = @(Get-Process -Name Illustrator -ErrorAction Stop)
    if ($processes.Count -ne 1) {
        throw "Ожидался ровно один Illustrator PID $ExpectedPid, найдено: " +
            (($processes | Select-Object -ExpandProperty Id) -join ', ')
    }
    $process = $processes[0]
    if ($process.Id -ne $ExpectedPid) {
        throw "PID Illustrator изменился: $ExpectedPid -> $($process.Id)"
    }
    if (-not $process.Responding) {
        throw "Illustrator PID $ExpectedPid не отвечает."
    }
    return $process
}

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$diagnosticsRoot = Join-Path $workspace "09_outputs\_diagnostics\full_$RunId"
$manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
$summaryPath = Join-Path $diagnosticsRoot 'summary.json'
$preflightSummaryPath = Join-Path $diagnosticsRoot 'preflight_summary.json'
$progressPath = Join-Path $diagnosticsRoot 'processing_progress.json'
$logPath = Join-Path $diagnosticsRoot 'processing_orchestrator.log'
$runScript = Join-Path $PSScriptRoot 'run_full_mkd2.ps1'
$verifyScript = Join-Path $PSScriptRoot 'verify_full_mkd2.ps1'

foreach ($required in @(
    $manifestPath,
    $summaryPath,
    $preflightSummaryPath,
    $runScript,
    $verifyScript
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Не найден обязательный файл: $required"
    }
}

$preflight = Get-Content -LiteralPath $preflightSummaryPath `
    -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not (Test-StrictTrue $preflight.accepted_distribution) -or
    [string]$preflight.run_id -ne $RunId -or
    [int]$preflight.analyzed_ok -ne 388 -or
    [int]$preflight.errors -ne 0 -or
    [int]$preflight.pending -ne 0) {
    throw "Полный read-only preflight не принят."
}

$illustratorProcess = Assert-SameIllustrator -ExpectedPid (
    [int]$preflight.same_session_pid
)
$initialPid = $illustratorProcess.Id
$resumeTimestamp = (Get-Date).ToString('s')
if (Test-Path -LiteralPath $progressPath -PathType Leaf) {
    $previousProgress = Get-Content -LiteralPath $progressPath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($previousProgress.run_id -ne $RunId -or
        [int]$previousProgress.illustrator_pid -ne $initialPid) {
        throw "Существующий processing_progress относится к другому run/PID."
    }
    $startedAt = [string]$previousProgress.started_at
    $processBatches = [int]$previousProgress.process_batches
    $verifyBatches = [int]$previousProgress.verify_batches
    Append-Utf8Text -Path $logPath -Text (
        "[$resumeTimestamp] RESUME run_id=$RunId pid=$initialPid " +
        "batch_size=$BatchSize max_attempts=$MaxAttempts`r`n"
    )
} else {
    $startedAt = $resumeTimestamp
    $processBatches = 0
    $verifyBatches = 0
    Write-Utf8Text -Path $logPath -Text (
        "[$startedAt] START run_id=$RunId pid=$initialPid " +
        "batch_size=$BatchSize max_attempts=$MaxAttempts`r`n"
    )
}

try {
    while ($true) {
        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        if ($manifestRows.Count -ne 388) {
            throw "Manifest содержит $($manifestRows.Count) строк вместо 388."
        }
        $counts = Get-StatusCounts -Rows $manifestRows
        if ($counts.SOURCE_HASH_MISMATCH -gt 0) {
            throw "Обнаружен SOURCE_HASH_MISMATCH."
        }
        if ($counts.OK -eq 388) {
            break
        }

        $exhaustedProcess = @(
            $manifestRows |
                Where-Object {
                    $_.status -eq 'ERROR' -and
                    [int]$_.attempts -ge $MaxAttempts
                }
        )
        if ($exhaustedProcess.Count -gt 0) {
            throw "$($exhaustedProcess.Count) файлов исчерпали $MaxAttempts попытки обработки."
        }
        $exhaustedVerify = @(
            $manifestRows |
                Where-Object {
                    $_.status -eq 'VERIFY_ERROR' -and
                    $_.PSObject.Properties['verify_attempts'] -and
                    [int]$_.verify_attempts -ge $MaxAttempts
                }
        )
        if ($exhaustedVerify.Count -gt 0) {
            throw "$($exhaustedVerify.Count) файлов исчерпали $MaxAttempts попытки verify."
        }

        if ($counts.PROCESSED_OK -gt 0 -or $counts.VERIFY_ERROR -gt 0) {
            $verifyCandidate = $manifestRows |
                Where-Object {
                    $_.status -eq 'PROCESSED_OK' -or
                    $_.status -eq 'VERIFY_ERROR'
                } |
                Sort-Object { [int]$_.index } |
                Select-Object -First 1
            $verifyResult = & $verifyScript `
                -RunId $RunId `
                -Stage Verify `
                -StartIndex ([int]$verifyCandidate.index) `
                -MaxFiles $BatchSize
            $verifyBatches += 1
            $action = 'VERIFY'
        } elseif ($counts.PENDING -gt 0 -or $counts.ERROR -gt 0) {
            $processCandidate = $manifestRows |
                Where-Object {
                    $_.status -eq 'PENDING' -or
                    $_.status -eq 'ERROR'
                } |
                Sort-Object { [int]$_.index } |
                Select-Object -First 1
            $processResult = & $runScript `
                -RunId $RunId `
                -Stage Process `
                -StartIndex ([int]$processCandidate.index) `
                -MaxFiles $BatchSize
            $processBatches += 1
            $action = 'PROCESS'
        } else {
            throw "Manifest находится в неподдерживаемом наборе статусов."
        }

        $illustratorProcess = Assert-SameIllustrator -ExpectedPid $initialPid
        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        $counts = Get-StatusCounts -Rows $manifestRows
        $timestamp = (Get-Date).ToString('s')
        $completed = $counts.OK
        $remaining = 388 - $completed
        Append-Utf8Text -Path $logPath -Text (
            "[$timestamp] ACTION=$action process_batches=$processBatches " +
            "verify_batches=$verifyBatches ok=$completed pending=$($counts.PENDING) " +
            "processed=$($counts.PROCESSED_OK) process_error=$($counts.ERROR) " +
            "verify_error=$($counts.VERIFY_ERROR) pid=$initialPid " +
            "working_set=$($illustratorProcess.WorkingSet64)`r`n"
        )
        Write-Utf8Text -Path $progressPath -Text (
            [ordered]@{
                schema_version = 1
                run_id = $RunId
                status = 'running'
                started_at = $startedAt
                updated_at = $timestamp
                illustrator_pid = $initialPid
                illustrator_working_set_bytes = $illustratorProcess.WorkingSet64
                process_batches = $processBatches
                verify_batches = $verifyBatches
                ok = $completed
                remaining = $remaining
                statuses = $counts
                error = ''
            } | ConvertTo-Json -Depth 6
        )
    }

    $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
    $nonOk = @($manifestRows | Where-Object status -ne 'OK')
    if ($manifestRows.Count -ne 388 -or $nonOk.Count -ne 0) {
        throw "Финальное состояние оркестратора не равно 388 OK."
    }
    $illustratorProcess = Assert-SameIllustrator -ExpectedPid $initialPid
    $completedAt = (Get-Date).ToString('s')
    Write-Utf8Text -Path $progressPath -Text (
        [ordered]@{
            schema_version = 1
            run_id = $RunId
            status = 'completed'
            started_at = $startedAt
            updated_at = $completedAt
            illustrator_pid = $initialPid
            illustrator_working_set_bytes = $illustratorProcess.WorkingSet64
            process_batches = $processBatches
            verify_batches = $verifyBatches
            ok = 388
            remaining = 0
            statuses = (Get-StatusCounts -Rows $manifestRows)
            error = ''
        } | ConvertTo-Json -Depth 6
    )
    Append-Utf8Text -Path $logPath -Text (
        "[$completedAt] COMPLETE ok=388 pid=$initialPid`r`n"
    )

    $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
    $summary.stage = 'processing_completed'
    $summary | Add-Member -NotePropertyName processing_completed_at `
        -NotePropertyValue $completedAt -Force
    $summary | Add-Member -NotePropertyName illustrator_pid `
        -NotePropertyValue $initialPid -Force
    Write-Utf8Text -Path $summaryPath -Text ($summary | ConvertTo-Json -Depth 14)
} catch {
    $failedAt = (Get-Date).ToString('s')
    $manifestRows = @(
        if (Test-Path -LiteralPath $manifestPath) {
            Import-Csv -LiteralPath $manifestPath -Encoding UTF8
        }
    )
    Write-Utf8Text -Path $progressPath -Text (
        [ordered]@{
            schema_version = 1
            run_id = $RunId
            status = 'error'
            started_at = $startedAt
            updated_at = $failedAt
            illustrator_pid = $initialPid
            process_batches = $processBatches
            verify_batches = $verifyBatches
            statuses = if ($manifestRows.Count) {
                Get-StatusCounts -Rows $manifestRows
            } else {
                @{}
            }
            error = $_.Exception.Message
        } | ConvertTo-Json -Depth 6
    )
    Append-Utf8Text -Path $logPath -Text (
        "[$failedAt] ERROR $($_.Exception.Message)`r`n"
    )
    throw
}
