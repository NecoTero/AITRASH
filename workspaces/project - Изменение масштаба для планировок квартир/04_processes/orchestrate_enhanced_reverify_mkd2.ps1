[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RunId,

    [ValidateRange(1, 25)]
    [int]$BatchSize = 25,

    [ValidateRange(2, 10)]
    [int]$MaxTotalVerifyAttempts = 4,

    [ValidateRange(0, 1000)]
    [int]$MaxBatches = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Utf8Text {
    param([string]$Path, [string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Write-Utf8Csv {
    param([string]$Path, [object[]]$Rows)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllLines(
        $Path,
        @($Rows | ConvertTo-Csv -NoTypeInformation),
        $encoding
    )
}

function Append-Utf8Text {
    param([string]$Path, [string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::AppendAllText($Path, $Text, $encoding)
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
    if ($process.Id -ne $ExpectedPid -or -not $process.Responding) {
        throw "Illustrator PID $ExpectedPid не отвечает."
    }
    return $process
}

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$diagnosticsRoot = Join-Path $workspace "09_outputs\_diagnostics\full_$RunId"
$manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
$manifestBackupPath = Join-Path $diagnosticsRoot `
    'manifest_before_enhanced_reverify.csv'
$summaryPath = Join-Path $diagnosticsRoot 'summary.json'
$preflightSummaryPath = Join-Path $diagnosticsRoot 'preflight_summary.json'
$processingProgressPath = Join-Path $diagnosticsRoot 'processing_progress.json'
$progressPath = Join-Path $diagnosticsRoot 'enhanced_reverify_progress.json'
$logPath = Join-Path $diagnosticsRoot 'enhanced_reverify.log'
$verifyScript = Join-Path $PSScriptRoot 'verify_full_mkd2.ps1'
$verifyJsx = Join-Path $PSScriptRoot 'presale_site_verify.jsx'
$expectedVerifier = '1.1.0-independent-full-ancestry'

foreach ($required in @(
    $manifestPath,
    $summaryPath,
    $preflightSummaryPath,
    $processingProgressPath,
    $verifyScript,
    $verifyJsx
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Не найден обязательный файл: $required"
    }
}
$verifyJsxText = Get-Content -LiteralPath $verifyJsx -Raw -Encoding UTF8
if (-not $verifyJsxText.Contains(
        "var SCRIPT_VERSION = `"$expectedVerifier`";"
    ) -or
    -not $verifyJsxText.Contains('full_ancestry_path')) {
    throw (
        "presale_site_verify.jsx не содержит реальную full-ancestry " +
        "реализацию версии $expectedVerifier."
    )
}

$preflight = Get-Content -LiteralPath $preflightSummaryPath `
    -Raw -Encoding UTF8 | ConvertFrom-Json
$processing = Get-Content -LiteralPath $processingProgressPath `
    -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not (Test-StrictTrue $preflight.accepted_distribution) -or
    [string]$preflight.run_id -ne $RunId -or
    [int]$preflight.analyzed_ok -ne 388 -or
    $processing.status -ne 'completed' -or
    [int]$processing.ok -ne 388 -or
    [int]$processing.remaining -ne 0 -or
    [int]$preflight.same_session_pid -ne [int]$processing.illustrator_pid) {
    throw "Исходный прогон/preflight не подтверждает 388 OK в одном сеансе."
}
$expectedPid = [int]$processing.illustrator_pid
[void](Assert-SameIllustrator -ExpectedPid $expectedPid)

$startedAt = (Get-Date).ToString('s')
$batches = 0
$sessionBatches = 0
$resuming = Test-Path -LiteralPath $progressPath -PathType Leaf
$needsInitialization = $false
$manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
if ($manifestRows.Count -ne 388) {
    throw "Manifest должен содержать 388 строк."
}

if (-not $resuming) {
    if (@($manifestRows | Where-Object status -ne 'OK').Count -ne 0) {
        throw "Первичный enhanced reverify запускается только из состояния 388 OK."
    }
    if (Test-Path -LiteralPath $manifestBackupPath -PathType Leaf) {
        $backupRows = @(
            Import-Csv -LiteralPath $manifestBackupPath -Encoding UTF8
        )
        if ($backupRows.Count -ne 388 -or
            @($backupRows | Group-Object source_relpath).Count -ne 388) {
            throw "Существующий backup manifest enhanced reverify повреждён."
        }
    } else {
        Write-Utf8Csv -Path $manifestBackupPath -Rows $manifestRows
    }
    if (Test-Path -LiteralPath $logPath -PathType Leaf) {
        Append-Utf8Text -Path $logPath -Text (
            "[$startedAt] RECOVER_INITIALIZE run_id=$RunId " +
            "pid=$expectedPid`r`n"
        )
    } else {
        Write-Utf8Text -Path $logPath -Text (
            "[$startedAt] START run_id=$RunId pid=$expectedPid " +
            "batch_size=$BatchSize`r`n"
        )
    }
    Write-Utf8Text -Path $progressPath -Text (
        [ordered]@{
            schema_version = 1
            run_id = $RunId
            status = 'initializing'
            started_at = $startedAt
            updated_at = $startedAt
            illustrator_pid = $expectedPid
            batches = 0
            ok = 0
            remaining = 388
            verify_errors = 0
            verifier = $expectedVerifier
            error = ''
        } | ConvertTo-Json -Depth 6
    )
    $needsInitialization = $true
} else {
    $previousProgress = Get-Content -LiteralPath $progressPath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$previousProgress.run_id -ne $RunId -or
        [int]$previousProgress.illustrator_pid -ne $expectedPid -or
        [string]$previousProgress.verifier -ne $expectedVerifier) {
        throw "Существующий enhanced progress относится к другому run/PID/verifier."
    }
    if ($previousProgress.status -eq 'completed') {
        if (@($manifestRows | Where-Object status -ne 'OK').Count -ne 0) {
            throw "Enhanced reverify отмечен completed, но manifest не 388 OK."
        }
        $previousProgress
        return
    }
    $startedAt = [string]$previousProgress.started_at
    $batches = [int]$previousProgress.batches
    if ($previousProgress.status -eq 'initializing') {
        $needsInitialization = $true
    }
    Append-Utf8Text -Path $logPath -Text (
        "[$startedAt] RESUME run_id=$RunId pid=$expectedPid`r`n"
    )
}

if ($needsInitialization) {
    $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
    foreach ($row in $manifestRows) {
        $row.status = 'PROCESSED_OK'
        $row.last_error = ''
    }
    Write-Utf8Csv -Path $manifestPath -Rows $manifestRows
    $initializedAt = (Get-Date).ToString('s')
    Write-Utf8Text -Path $progressPath -Text (
        [ordered]@{
            schema_version = 1
            run_id = $RunId
            status = 'running'
            started_at = $startedAt
            updated_at = $initializedAt
            illustrator_pid = $expectedPid
            batches = 0
            ok = 0
            remaining = 388
            verify_errors = 0
            verifier = $expectedVerifier
            error = ''
        } | ConvertTo-Json -Depth 6
    )
}

try {
    while ($true) {
        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        $okCount = @($manifestRows | Where-Object status -eq 'OK').Count
        if ($okCount -eq 388) {
            break
        }
        $unsupported = @(
            $manifestRows |
                Where-Object {
                    $_.status -ne 'OK' -and
                    $_.status -ne 'PROCESSED_OK' -and
                    $_.status -ne 'VERIFY_ERROR'
                }
        )
        if ($unsupported.Count -ne 0) {
            throw "Enhanced reverify встретил неподдерживаемые статусы."
        }
        $exhausted = @(
            $manifestRows |
                Where-Object {
                    $_.status -eq 'VERIFY_ERROR' -and
                    [int]$_.verify_attempts -ge $MaxTotalVerifyAttempts
                }
        )
        if ($exhausted.Count -ne 0) {
            throw "$($exhausted.Count) файлов исчерпали verify attempts."
        }

        $candidate = $manifestRows |
            Where-Object {
                $_.status -eq 'PROCESSED_OK' -or
                $_.status -eq 'VERIFY_ERROR'
            } |
            Sort-Object { [int]$_.index } |
            Select-Object -First 1
        $result = & $verifyScript `
            -RunId $RunId `
            -Stage Verify `
            -StartIndex ([int]$candidate.index) `
            -MaxFiles $BatchSize
        $batches += 1
        $sessionBatches += 1
        $illustrator = Assert-SameIllustrator -ExpectedPid $expectedPid
        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        $okCount = @($manifestRows | Where-Object status -eq 'OK').Count
        $verifyErrors = @(
            $manifestRows |
                Where-Object status -eq 'VERIFY_ERROR'
        ).Count
        $timestamp = (Get-Date).ToString('s')
        $progress = [ordered]@{
            schema_version = 1
            run_id = $RunId
            status = 'running'
            started_at = $startedAt
            updated_at = $timestamp
            illustrator_pid = $expectedPid
            illustrator_working_set_bytes = $illustrator.WorkingSet64
            batches = $batches
            ok = $okCount
            remaining = 388 - $okCount
            verify_errors = $verifyErrors
            last_batch = $result.BatchId
            verifier = $expectedVerifier
            error = ''
        }
        Write-Utf8Text -Path $progressPath -Text (
            $progress | ConvertTo-Json -Depth 6
        )
        Append-Utf8Text -Path $logPath -Text (
            "[$timestamp] BATCH=$($result.BatchId) ok=$okCount " +
            "remaining=$(388 - $okCount) errors=$verifyErrors " +
            "pid=$expectedPid`r`n"
        )
        if ($MaxBatches -gt 0 -and
            $sessionBatches -ge $MaxBatches -and
            $okCount -lt 388) {
            $progress['status'] = 'paused'
            $progress['updated_at'] = (Get-Date).ToString('s')
            Write-Utf8Text -Path $progressPath -Text (
                $progress | ConvertTo-Json -Depth 6
            )
            Append-Utf8Text -Path $logPath -Text (
                "[$($progress['updated_at'])] PAUSED max_batches=$MaxBatches " +
                "ok=$okCount remaining=$(388 - $okCount)`r`n"
            )
            [pscustomobject]$progress
            return
        }
    }

    $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
    if ($manifestRows.Count -ne 388 -or
        @($manifestRows | Where-Object status -ne 'OK').Count -ne 0) {
        throw "Enhanced reverify не завершился состоянием 388 OK."
    }
    $illustrator = Assert-SameIllustrator -ExpectedPid $expectedPid
    $completedAt = (Get-Date).ToString('s')
    $completed = [ordered]@{
        schema_version = 1
        run_id = $RunId
        status = 'completed'
        started_at = $startedAt
        updated_at = $completedAt
        illustrator_pid = $expectedPid
        illustrator_working_set_bytes = $illustrator.WorkingSet64
        batches = $batches
        ok = 388
        remaining = 0
        verify_errors = 0
        verifier = $expectedVerifier
        manifest_backup = $manifestBackupPath
        error = ''
    }
    Write-Utf8Text -Path $progressPath -Text (
        $completed | ConvertTo-Json -Depth 6
    )
    Append-Utf8Text -Path $logPath -Text (
        "[$completedAt] COMPLETE ok=388 pid=$expectedPid`r`n"
    )

    $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
    $summary.stage = 'enhanced_reverify_completed'
    $summary | Add-Member -NotePropertyName enhanced_reverify `
        -NotePropertyValue $completed -Force
    Write-Utf8Text -Path $summaryPath -Text (
        $summary | ConvertTo-Json -Depth 14
    )
    $completed
} catch {
    $failedAt = (Get-Date).ToString('s')
    $manifestRows = @(
        if (Test-Path -LiteralPath $manifestPath) {
            Import-Csv -LiteralPath $manifestPath -Encoding UTF8
        }
    )
    $failed = [ordered]@{
        schema_version = 1
        run_id = $RunId
        status = 'error'
        started_at = $startedAt
        updated_at = $failedAt
        illustrator_pid = $expectedPid
        batches = $batches
        ok = @($manifestRows | Where-Object status -eq 'OK').Count
        remaining = @($manifestRows | Where-Object status -ne 'OK').Count
        verify_errors = @(
            $manifestRows |
                Where-Object status -eq 'VERIFY_ERROR'
        ).Count
        verifier = $expectedVerifier
        error = $_.Exception.Message
    }
    Write-Utf8Text -Path $progressPath -Text (
        $failed | ConvertTo-Json -Depth 6
    )
    Append-Utf8Text -Path $logPath -Text (
        "[$failedAt] ERROR $($_.Exception.Message)`r`n"
    )
    throw
}
