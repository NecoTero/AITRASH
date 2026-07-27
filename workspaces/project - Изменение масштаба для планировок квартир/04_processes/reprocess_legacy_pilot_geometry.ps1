[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RunId
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

function Test-SamePath {
    param([string]$Left, [string]$Right)
    if (-not $Left -or -not $Right) {
        return $false
    }
    try {
        return [string]::Equals(
            [System.IO.Path]::GetFullPath($Left),
            [System.IO.Path]::GetFullPath($Right),
            [System.StringComparison]::OrdinalIgnoreCase
        )
    } catch {
        return $false
    }
}

function Get-VerifyAttempt {
    param([object]$Row)
    $name = [System.IO.Path]::GetFileName([string]$Row.verify_audit)
    if ($name -match 'verify_attempt(?<attempt>\d+)\.json$') {
        return [int]$Matches.attempt
    }
    return 0
}

function Assert-SameIllustrator {
    param([int]$ExpectedPid)
    for ($retry = 0; $retry -lt 10; $retry += 1) {
        $processes = @(Get-Process -Name Illustrator -ErrorAction Stop)
        if ($processes.Count -ne 1) {
            throw "Ожидался ровно один Illustrator PID $ExpectedPid, найдено: " +
                (($processes | Select-Object -ExpandProperty Id) -join ', ')
        }
        $process = $processes[0]
        if ($process.Id -ne $ExpectedPid) {
            throw "PID Illustrator изменился: $ExpectedPid -> $($process.Id)"
        }
        if ($process.Responding) {
            return $process
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Illustrator PID $ExpectedPid не отвечает."
}

function Test-CurrentGeometryProof {
    param(
        [object]$ManifestRow,
        [string]$RunIdValue,
        [string]$VerifyReportPath
    )
    if ($ManifestRow.status -ne 'OK' -or
        -not $ManifestRow.audit_json -or
        -not (Test-Path -LiteralPath $ManifestRow.audit_json -PathType Leaf)) {
        return $false
    }
    try {
        $audit = Get-Content -LiteralPath $ManifestRow.audit_json `
            -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not (
            $audit.status -eq 'OK' -and
            $audit.run_id -eq $RunIdValue -and
            [int]$audit.index -eq [int]$ManifestRow.index -and
            [int]$audit.attempt -eq [int]$ManifestRow.attempts -and
            $audit.source_relpath -eq $ManifestRow.source_relpath -and
            (Test-SamePath $audit.source_ai $ManifestRow.source_ai) -and
            (Test-SamePath $audit.output_ai $ManifestRow.output_ai) -and
            (Test-SamePath $audit.output_png $ManifestRow.output_png) -and
            (Test-StrictTrue $audit.pixel_transfer.item_geometry_match) -and
            (Test-StrictTrue $audit.reopen_verification.item_geometry_match)
        )) {
            return $false
        }
        foreach ($output in @(
            @{
                Path = [string]$ManifestRow.output_ai
                Hash = [string]$ManifestRow.output_ai_sha256
            },
            @{
                Path = [string]$ManifestRow.output_png
                Hash = [string]$ManifestRow.output_png_sha256
            }
        )) {
            if (-not (Test-Path -LiteralPath $output.Path -PathType Leaf) -or
                (
                    Get-FileHash -LiteralPath $output.Path -Algorithm SHA256
                ).Hash.ToLowerInvariant() -ne $output.Hash) {
                return $false
            }
        }
        if ([int]$ManifestRow.verify_attempts -lt 1 -or
            -not (Test-Path -LiteralPath $VerifyReportPath -PathType Leaf)) {
            return $false
        }
        $latestVerify = Import-Csv -LiteralPath $VerifyReportPath -Encoding UTF8 |
            Where-Object {
                [int]$_.index -eq [int]$ManifestRow.index
            } |
            Sort-Object { Get-VerifyAttempt -Row $_ } |
            Select-Object -Last 1
        return (
            $latestVerify -and
            $latestVerify.status -eq 'OK' -and
            $latestVerify.source_relpath -eq $ManifestRow.source_relpath -and
            (Test-SamePath $latestVerify.output_ai $ManifestRow.output_ai) -and
            (Test-SamePath $latestVerify.output_png $ManifestRow.output_png) -and
            (Test-SamePath $latestVerify.process_audit $ManifestRow.audit_json)
        )
    } catch {
        return $false
    }
}

function Move-LegacyOutput {
    param(
        [string]$Source,
        [string]$ExpectedHash,
        [string]$Destination
    )
    if (Test-Path -LiteralPath $Source -PathType Leaf) {
        if (Test-Path -LiteralPath $Destination) {
            throw "Quarantine target уже существует: $Destination"
        }
        $actualHash = (
            Get-FileHash -LiteralPath $Source -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($actualHash -ne $ExpectedHash) {
            throw "SHA-256 legacy output изменился: $Source"
        }
        Move-Item -LiteralPath $Source -Destination $Destination
        return
    }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        throw "Нет ни legacy output, ни quarantine copy: $Source"
    }
    $quarantineHash = (
        Get-FileHash -LiteralPath $Destination -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($quarantineHash -ne $ExpectedHash) {
        throw "SHA-256 quarantine output не совпал: $Destination"
    }
}

$legacyIndices = @(38, 68, 164, 168, 233, 355, 384)
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$diagnosticsRoot = Join-Path $workspace "09_outputs\_diagnostics\full_$RunId"
$manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
$manifestBackupPath = Join-Path $diagnosticsRoot `
    'manifest_before_legacy_geometry_reprocess.csv'
$preflightPath = Join-Path $diagnosticsRoot 'preflight_summary.json'
$processingPath = Join-Path $diagnosticsRoot 'processing_progress.json'
$verifyReportPath = Join-Path $diagnosticsRoot 'verify_report.csv'
$progressPath = Join-Path $diagnosticsRoot `
    'legacy_geometry_reprocess.json'
$logPath = Join-Path $diagnosticsRoot 'legacy_geometry_reprocess.log'
$quarantineRoot = Join-Path $diagnosticsRoot `
    'superseded_legacy_pilot_geometry'
$runScript = Join-Path $PSScriptRoot 'run_full_mkd2.ps1'
$verifyScript = Join-Path $PSScriptRoot 'verify_full_mkd2.ps1'

foreach ($required in @(
    $manifestPath,
    $preflightPath,
    $processingPath,
    $runScript,
    $verifyScript
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Не найден обязательный файл: $required"
    }
}

$preflight = Get-Content -LiteralPath $preflightPath `
    -Raw -Encoding UTF8 | ConvertFrom-Json
$processing = Get-Content -LiteralPath $processingPath `
    -Raw -Encoding UTF8 | ConvertFrom-Json
if ($processing.status -ne 'completed' -or
    [int]$processing.ok -ne 388 -or
    [int]$processing.remaining -ne 0 -or
    [int]$preflight.same_session_pid -ne [int]$processing.illustrator_pid) {
    throw "Legacy geometry remediation запускается только после primary 388 OK."
}
$expectedPid = [int]$processing.illustrator_pid
[void](Assert-SameIllustrator -ExpectedPid $expectedPid)

$manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
if ($manifestRows.Count -ne 388) {
    throw "Manifest должен содержать 388 строк."
}
if (-not (Test-Path -LiteralPath $manifestBackupPath -PathType Leaf)) {
    Write-Utf8Csv -Path $manifestBackupPath -Rows $manifestRows
}
[System.IO.Directory]::CreateDirectory($quarantineRoot) | Out-Null

$startedAt = (Get-Date).ToString('s')
if (Test-Path -LiteralPath $logPath -PathType Leaf) {
    Append-Utf8Text -Path $logPath -Text (
        "[$startedAt] RESUME run_id=$RunId pid=$expectedPid`r`n"
    )
} else {
    Write-Utf8Text -Path $logPath -Text (
        "[$startedAt] START run_id=$RunId pid=$expectedPid`r`n"
    )
}

$completed = New-Object System.Collections.Generic.List[int]
try {
    foreach ($index in $legacyIndices) {
        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        $row = $manifestRows |
            Where-Object { [int]$_.index -eq $index } |
            Select-Object -First 1
        if (-not $row) {
            throw "Manifest не содержит legacy index $index."
        }

        if (Test-CurrentGeometryProof `
            -ManifestRow $row `
            -RunIdValue $RunId `
            -VerifyReportPath $verifyReportPath) {
            $completed.Add($index)
            continue
        }

        if ($row.status -eq 'OK') {
            foreach ($output in @(
                @{
                    Path = [string]$row.output_ai
                    Hash = [string]$row.output_ai_sha256
                },
                @{
                    Path = [string]$row.output_png
                    Hash = [string]$row.output_png_sha256
                }
            )) {
                $legacyName = '{0:D3}_attempt{1}_legacy_{2}' -f (
                    $index
                ), (
                    [int]$row.attempts
                ), (
                    [System.IO.Path]::GetFileName($output.Path)
                )
                Move-LegacyOutput `
                    -Source $output.Path `
                    -ExpectedHash $output.Hash `
                    -Destination (Join-Path $quarantineRoot $legacyName)
            }
            $row.status = 'ERROR'
            $row.output_ai = ''
            $row.output_png = ''
            $row.output_ai_sha256 = ''
            $row.output_png_sha256 = ''
            $row.audit_json = ''
            $row.last_error = 'LEGACY_GEOMETRY_PROOF_REPROCESS'
            Write-Utf8Csv -Path $manifestPath -Rows $manifestRows
        }

        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        $row = $manifestRows |
            Where-Object { [int]$_.index -eq $index } |
            Select-Object -First 1
        if ($row.status -eq 'ERROR' -or $row.status -eq 'PENDING') {
            $processResult = & $runScript `
                -RunId $RunId `
                -Stage Process `
                -StartIndex $index `
                -MaxFiles 1
            [void](Assert-SameIllustrator -ExpectedPid $expectedPid)
            if ([int]$processResult.ProcessedOk -ne 1 -or
                [int]$processResult.Errors -ne 0) {
                throw "Новая process-попытка не принята для index $index."
            }
        }

        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        $row = $manifestRows |
            Where-Object { [int]$_.index -eq $index } |
            Select-Object -First 1
        if ($row.status -eq 'PROCESSED_OK' -or
            $row.status -eq 'VERIFY_ERROR') {
            $verifyResult = & $verifyScript `
                -RunId $RunId `
                -Stage Verify `
                -StartIndex $index `
                -MaxFiles 1
            [void](Assert-SameIllustrator -ExpectedPid $expectedPid)
            if ([int]$verifyResult.Ok -ne 1 -or
                [int]$verifyResult.Errors -ne 0) {
                throw "Новый verify не принят для index $index."
            }
        }

        $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
        $row = $manifestRows |
            Where-Object { [int]$_.index -eq $index } |
            Select-Object -First 1
        if (-not (Test-CurrentGeometryProof `
            -ManifestRow $row `
            -RunIdValue $RunId `
            -VerifyReportPath $verifyReportPath)) {
            throw "Новый boolean geometry proof отсутствует для index $index."
        }
        $completed.Add($index)
        $timestamp = (Get-Date).ToString('s')
        Append-Utf8Text -Path $logPath -Text (
            "[$timestamp] OK index=$index attempts=$($row.attempts) " +
            "verify_attempts=$($row.verify_attempts) pid=$expectedPid`r`n"
        )
        Write-Utf8Text -Path $progressPath -Text (
            [ordered]@{
                schema_version = 1
                run_id = $RunId
                status = 'running'
                started_at = $startedAt
                updated_at = $timestamp
                illustrator_pid = $expectedPid
                required_indices = $legacyIndices
                completed_indices = $completed.ToArray()
                completed = $completed.Count
                remaining = $legacyIndices.Count - $completed.Count
                quarantine_root = $quarantineRoot
                error = ''
            } | ConvertTo-Json -Depth 6
        )
    }

    if ($completed.Count -ne $legacyIndices.Count) {
        throw "Legacy geometry remediation завершила не все семь файлов."
    }
    $finishedAt = (Get-Date).ToString('s')
    $result = [ordered]@{
        schema_version = 1
        run_id = $RunId
        status = 'completed'
        started_at = $startedAt
        updated_at = $finishedAt
        illustrator_pid = $expectedPid
        required_indices = $legacyIndices
        completed_indices = $completed.ToArray()
        completed = $completed.Count
        remaining = 0
        quarantine_root = $quarantineRoot
        manifest_backup = $manifestBackupPath
        error = ''
    }
    Write-Utf8Text -Path $progressPath -Text (
        $result | ConvertTo-Json -Depth 6
    )
    Append-Utf8Text -Path $logPath -Text (
        "[$finishedAt] COMPLETE count=7 pid=$expectedPid`r`n"
    )
    $result
} catch {
    $failedAt = (Get-Date).ToString('s')
    $failed = [ordered]@{
        schema_version = 1
        run_id = $RunId
        status = 'error'
        started_at = $startedAt
        updated_at = $failedAt
        illustrator_pid = $expectedPid
        required_indices = $legacyIndices
        completed_indices = $completed.ToArray()
        completed = $completed.Count
        remaining = $legacyIndices.Count - $completed.Count
        quarantine_root = $quarantineRoot
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
