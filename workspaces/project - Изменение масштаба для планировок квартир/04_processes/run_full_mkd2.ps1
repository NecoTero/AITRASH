[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RunId,

    [ValidateSet('Initialize', 'Process')]
    [string]$Stage = 'Initialize',

    [ValidateRange(0, 1000000)]
    [int]$StartIndex = 0,

    [ValidateRange(0, 1000)]
    [int]$MaxFiles = 25
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Utf8Text {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Write-Utf8Csv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [object[]]$Rows
    )

    if ($Rows.Count -eq 0) {
        throw "Нельзя записать пустой CSV: $Path"
    }

    $lines = @($Rows | ConvertTo-Csv -NoTypeInformation)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllLines($Path, $lines, $encoding)
}

function Assert-ChildPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    if (-not $pathFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Путь выходит за пределы workspace: $pathFull"
    }
}

function Get-OverrideRows {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $lines = [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)
    $dataLines = @(
        $lines |
            Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') }
    )
    if ($dataLines.Count -lt 1 -or $dataLines[0] -ne 'source_relpath,scale_percent,reason') {
        throw "Некорректный заголовок scale_overrides.csv."
    }
    if ($dataLines.Count -eq 1) {
        return @()
    }

    $rows = @($dataLines -join [Environment]::NewLine | ConvertFrom-Csv)
    $seen = @{}
    foreach ($row in $rows) {
        $key = ([string]$row.source_relpath).Replace('\', '/').ToLowerInvariant()
        if (-not $key) {
            throw "В scale_overrides.csv найден пустой source_relpath."
        }
        if ($seen.ContainsKey($key)) {
            throw "В scale_overrides.csv найден повтор пути: $($row.source_relpath)"
        }
        $seen[$key] = $true
        if ([int]$row.scale_percent -ne 140) {
            throw "Для полного прогона разрешён только ручной override 140%: $($row.source_relpath)"
        }
        if (-not ([string]$row.reason).Trim()) {
            throw "Для override не заполнена причина: $($row.source_relpath)"
        }
    }
    return $rows
}

function Initialize-Run {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Workspace,

        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$RunIdValue
    )

    $corpusNames = @('Корпус 2.1', 'Корпус 2.2', 'Корпус 2.3')
    $expectedCounts = @{
        'Корпус 2.1' = 157
        'Корпус 2.2' = 53
        'Корпус 2.3' = 178
    }

    $diagnosticsRoot = Join-Path $Workspace "09_outputs\_diagnostics\full_$RunIdValue"
    $detailsRoot = Join-Path $diagnosticsRoot 'details'
    $contactSheetsRoot = Join-Path $diagnosticsRoot 'contact_sheets'
    $stagingRoot = Join-Path $diagnosticsRoot 'staging'
    $outputRoot = Join-Path $Workspace "09_outputs\_full_wip\$RunIdValue"
    $manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
    $summaryPath = Join-Path $diagnosticsRoot 'summary.json'

    foreach ($path in @($diagnosticsRoot, $detailsRoot, $contactSheetsRoot, $stagingRoot, $outputRoot)) {
        Assert-ChildPath -Root $Workspace -Path $path
        [System.IO.Directory]::CreateDirectory($path) | Out-Null
    }

    if (Test-Path -LiteralPath $manifestPath) {
        throw "Manifest уже существует; повторная инициализация запрещена: $manifestPath"
    }

    $overridePath = Join-Path $PSScriptRoot 'scale_overrides.csv'
    $overrides = @(Get-OverrideRows -Path $overridePath)
    $overrideByPath = @{}
    foreach ($override in $overrides) {
        $overrideByPath[([string]$override.source_relpath).Replace('\', '/').ToLowerInvariant()] = $override
    }

    $rows = New-Object System.Collections.Generic.List[object]
    $inventory = New-Object System.Collections.Generic.List[object]
    $index = 0

    foreach ($corpusName in $corpusNames) {
        $corpusPath = Join-Path $SourceRoot $corpusName
        if (-not (Test-Path -LiteralPath $corpusPath -PathType Container)) {
            throw "Не найден каталог корпуса: $corpusPath"
        }

        $aiFiles = @(
            Get-ChildItem -LiteralPath $corpusPath -File -Filter '*.ai' |
                Sort-Object @{ Expression = { $_.Name.ToLowerInvariant() } }
        )
        $pngFiles = @(
            Get-ChildItem -LiteralPath $corpusPath -File -Filter '*.png' |
                Sort-Object @{ Expression = { $_.Name.ToLowerInvariant() } }
        )
        $missingPng = @(
            $aiFiles |
                Where-Object {
                    -not (Test-Path -LiteralPath ([System.IO.Path]::ChangeExtension($_.FullName, '.png')))
                }
        )
        $orphanPng = @(
            $pngFiles |
                Where-Object {
                    -not (Test-Path -LiteralPath ([System.IO.Path]::ChangeExtension($_.FullName, '.ai')))
                }
        )

        $inventory.Add([pscustomobject]@{
            corpus = $corpusName
            ai_count = $aiFiles.Count
            png_count = $pngFiles.Count
            missing_png = $missingPng.Count
            orphan_png = $orphanPng.Count
        })

        if ($aiFiles.Count -ne $expectedCounts[$corpusName] -or
            $pngFiles.Count -ne $expectedCounts[$corpusName] -or
            $missingPng.Count -ne 0 -or
            $orphanPng.Count -ne 0) {
            throw "Инвентаризация $corpusName не совпала с контрольными числами."
        }

        foreach ($aiFile in $aiFiles) {
            $relativePath = "$corpusName/$($aiFile.Name)"
            $referencePng = [System.IO.Path]::ChangeExtension($aiFile.FullName, '.png')
            $sourceHash = (Get-FileHash -LiteralPath $aiFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            $overrideKey = $relativePath.ToLowerInvariant()
            $overrideScale = ''
            $overrideReason = ''
            if ($overrideByPath.ContainsKey($overrideKey)) {
                $overrideScale = [int]$overrideByPath[$overrideKey].scale_percent
                $overrideReason = [string]$overrideByPath[$overrideKey].reason
            }

            $rows.Add([pscustomobject][ordered]@{
                index = $index
                corpus = $corpusName
                source_relpath = $relativePath
                source_ai = $aiFile.FullName
                reference_png = $referencePng
                source_size_bytes = $aiFile.Length
                source_sha256_before = $sourceHash
                source_sha256_after = ''
                override_scale_percent = $overrideScale
                override_reason = $overrideReason
                status = 'PENDING'
                applied_scale_percent = ''
                output_ai = ''
                output_png = ''
                output_ai_sha256 = ''
                output_png_sha256 = ''
                audit_json = ''
                attempts = 0
                last_error = ''
            })
            $index += 1
        }
    }

    if ($rows.Count -ne 388) {
        throw "Manifest должен содержать 388 строк, фактически: $($rows.Count)"
    }

    $duplicates = @($rows | Group-Object source_relpath | Where-Object Count -gt 1)
    if ($duplicates.Count -ne 0) {
        throw "Manifest содержит повторяющиеся относительные пути."
    }

    $nestedOrExcludedAi = @(
        Get-ChildItem -LiteralPath $SourceRoot -Recurse -File -Filter '*.ai' |
            Where-Object {
                $parent = $_.DirectoryName
                -not ($corpusNames | ForEach-Object { Join-Path $SourceRoot $_ } | Where-Object { $_ -eq $parent })
            }
    )

    Write-Utf8Csv -Path $manifestPath -Rows $rows.ToArray()

    $summary = [ordered]@{
        schema_version = 1
        run_id = $RunIdValue
        created_at = (Get-Date).ToString('s')
        workspace = $Workspace
        source_root = $SourceRoot
        manifest = $manifestPath
        output_root = $outputRoot
        diagnostics_root = $diagnosticsRoot
        stage = 'initialized'
        inventory = $inventory.ToArray()
        total_ai = $rows.Count
        total_reference_png = ($inventory | Measure-Object png_count -Sum).Sum
        overrides = $overrides.Count
        excluded_nested_or_other_ai = $nestedOrExcludedAi.Count
        pending = $rows.Count
        ok = 0
        error = 0
        verified = 0
    }
    Write-Utf8Text -Path $summaryPath -Text ($summary | ConvertTo-Json -Depth 8)

    [pscustomobject]@{
        RunId = $RunIdValue
        Manifest = $manifestPath
        Summary = $summaryPath
        Rows = $rows.Count
        SourceBytes = ($rows | Measure-Object source_size_bytes -Sum).Sum
        Overrides = $overrides.Count
        ExcludedNestedOrOtherAi = $nestedOrExcludedAi.Count
    }
}

function Update-AggregateReport {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DiagnosticsRoot
    )

    $batchRoot = Join-Path $DiagnosticsRoot 'batches'
    $aggregatePath = Join-Path $DiagnosticsRoot 'report.csv'
    $batchFiles = @(
        Get-ChildItem -LiteralPath $batchRoot -File -Filter 'batch_*_report.csv' |
            Sort-Object Name
    )
    $allRows = New-Object System.Collections.Generic.List[object]
    foreach ($batchFile in $batchFiles) {
        $batchRows = @(Import-Csv -LiteralPath $batchFile.FullName -Encoding UTF8)
        foreach ($batchRow in $batchRows) {
            $allRows.Add($batchRow)
        }
    }
    if ($allRows.Count -gt 0) {
        Write-Utf8Csv -Path $aggregatePath -Rows $allRows.ToArray()
    }
    return $aggregatePath
}

function Update-RunSummary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SummaryPath,

        [Parameter(Mandatory = $true)]
        [object[]]$ManifestRows,

        [Parameter(Mandatory = $true)]
        [string]$LastBatch
    )

    $summary = Get-Content -LiteralPath $SummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $summary.stage = 'processing'
    $summary.pending = @($ManifestRows | Where-Object status -eq 'PENDING').Count
    $summary.ok = @($ManifestRows | Where-Object status -eq 'OK').Count
    $summary.error = @(
        $ManifestRows |
            Where-Object { $_.status -eq 'ERROR' -or $_.status -eq 'SOURCE_HASH_MISMATCH' }
    ).Count
    $summary.verified = @($ManifestRows | Where-Object status -eq 'OK').Count
    $summary | Add-Member -NotePropertyName processed_ok -NotePropertyValue (
        @($ManifestRows | Where-Object status -eq 'PROCESSED_OK').Count
    ) -Force
    $summary | Add-Member -NotePropertyName last_batch -NotePropertyValue $LastBatch -Force
    $summary | Add-Member -NotePropertyName updated_at -NotePropertyValue (
        (Get-Date).ToString('s')
    ) -Force
    Write-Utf8Text -Path $SummaryPath -Text ($summary | ConvertTo-Json -Depth 10)
}

function Process-RunBatch {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Workspace,

        [Parameter(Mandatory = $true)]
        [string]$RunIdValue,

        [Parameter(Mandatory = $true)]
        [int]$StartIndexValue,

        [Parameter(Mandatory = $true)]
        [int]$MaxFilesValue
    )

    $diagnosticsRoot = Join-Path $Workspace "09_outputs\_diagnostics\full_$RunIdValue"
    $detailsRoot = Join-Path $diagnosticsRoot 'details'
    $batchRoot = Join-Path $diagnosticsRoot 'batches'
    $stagingRoot = Join-Path $diagnosticsRoot 'staging'
    $outputRoot = Join-Path $Workspace "09_outputs\_full_wip\$RunIdValue"
    $manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
    $summaryPath = Join-Path $diagnosticsRoot 'summary.json'
    $scriptPath = Join-Path $PSScriptRoot 'presale_site_prepare.jsx'
    $activeJobPath = Join-Path $PSScriptRoot 'presale_site_job.json'

    foreach ($requiredPath in @($manifestPath, $summaryPath, $scriptPath)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Не найден обязательный файл: $requiredPath"
        }
    }
    foreach ($directory in @($detailsRoot, $batchRoot, $stagingRoot, $outputRoot)) {
        Assert-ChildPath -Root $Workspace -Path $directory
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }

    $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
    if ($manifestRows.Count -ne 388) {
        throw "Manifest должен содержать 388 строк."
    }

    $eligible = @(
        $manifestRows |
            Where-Object {
                [int]$_.index -ge $StartIndexValue -and
                ($_.status -eq 'PENDING' -or $_.status -eq 'ERROR')
            } |
            Sort-Object { [int]$_.index }
    )
    if ($MaxFilesValue -gt 0) {
        $eligible = @($eligible | Select-Object -First $MaxFilesValue)
    }
    if ($eligible.Count -eq 0) {
        return [pscustomobject]@{
            RunId = $RunIdValue
            Selected = 0
            Message = 'Нет записей PENDING/ERROR в заданном диапазоне.'
        }
    }

    $batchId = '{0:D3}_{1:D3}_{2}' -f (
        [int]$eligible[0].index
    ), (
        [int]$eligible[-1].index
    ), (
        Get-Date -Format 'yyyyMMdd_HHmmss'
    )
    $batchStagingRoot = Join-Path $stagingRoot $batchId
    [System.IO.Directory]::CreateDirectory($batchStagingRoot) | Out-Null
    $batchReportPath = Join-Path $batchRoot "batch_${batchId}_report.csv"
    $batchJobArchivePath = Join-Path $batchRoot "batch_${batchId}_job.json"

    if ((Test-Path -LiteralPath $batchReportPath) -or
        (Test-Path -LiteralPath $batchJobArchivePath)) {
        throw "Коллизия batch_id: $batchId"
    }

    $jobEntries = New-Object System.Collections.Generic.List[object]
    foreach ($manifestRow in $eligible) {
        $sourcePath = [string]$manifestRow.source_ai
        $sourceItem = Get-Item -LiteralPath $sourcePath
        if ([long]$sourceItem.Length -ne [long]$manifestRow.source_size_bytes) {
            throw "Размер исходника изменился: $($manifestRow.source_relpath)"
        }
        $actualHash = (
            Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($actualHash -ne $manifestRow.source_sha256_before) {
            throw "SHA-256 исходника изменился до пакета: $($manifestRow.source_relpath)"
        }

        $attempt = [int]$manifestRow.attempts + 1
        $sourceStem = [System.IO.Path]::GetFileNameWithoutExtension($sourcePath)
        $outputCorpusRoot = Join-Path $outputRoot ([string]$manifestRow.corpus)
        [System.IO.Directory]::CreateDirectory($outputCorpusRoot) | Out-Null
        $auditPath = Join-Path $detailsRoot (
            '{0:D3}_{1}_attempt{2}.json' -f [int]$manifestRow.index, $sourceStem, $attempt
        )
        if (Test-Path -LiteralPath $auditPath) {
            throw "Audit попытки уже существует: $auditPath"
        }

        $jobEntries.Add([pscustomobject][ordered]@{
            batch_id = $batchId
            index = [int]$manifestRow.index
            attempt = $attempt
            corpus = [string]$manifestRow.corpus
            source_relpath = [string]$manifestRow.source_relpath
            source_ai = $sourcePath
            reference_png = [string]$manifestRow.reference_png
            source_size_bytes = [long]$manifestRow.source_size_bytes
            source_sha256_before = [string]$manifestRow.source_sha256_before
            source_hash_preverified = $true
            output_dir = $outputCorpusRoot
            staging_dir = $batchStagingRoot
            audit_json = $auditPath
        })
    }

    $job = [ordered]@{
        schema_version = 1
        run_id = $RunIdValue
        batch_id = $batchId
        created_at = (Get-Date).ToString('s')
        batch_report = $batchReportPath
        entries = $jobEntries.ToArray()
    }
    $jobText = $job | ConvertTo-Json -Depth 8
    Write-Utf8Text -Path $batchJobArchivePath -Text $jobText
    Write-Utf8Text -Path $activeJobPath -Text $jobText

    $illustratorResult = ''
    $illustratorError = $null
    try {
        $illustrator = New-Object -ComObject Illustrator.Application
        $illustratorResult = [string]$illustrator.DoJavaScriptFile($scriptPath)
    } catch {
        $illustratorError = $_
    }

    if (-not (Test-Path -LiteralPath $batchReportPath)) {
        if ($illustratorError) {
            throw "Illustrator не создал batch report: $($illustratorError.Exception.Message)"
        }
        throw "Illustrator не создал batch report: $batchReportPath"
    }

    $batchRows = @(Import-Csv -LiteralPath $batchReportPath -Encoding UTF8)
    foreach ($batchRow in $batchRows) {
        $manifestRow = $manifestRows | Where-Object {
            [int]$_.index -eq [int]$batchRow.index
        } | Select-Object -First 1
        if (-not $manifestRow) {
            throw "Batch report содержит неизвестный индекс: $($batchRow.index)"
        }

        $manifestRow.attempts = [string]$batchRow.attempt
        $manifestRow.applied_scale_percent = [string]$batchRow.applied_scale_percent
        $manifestRow.audit_json = [string]$batchRow.audit_json
        $manifestRow.last_error = [string]$batchRow.comment
        $sourceHashAfter = (
            Get-FileHash -LiteralPath $manifestRow.source_ai -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        $manifestRow.source_sha256_after = $sourceHashAfter

        if ($sourceHashAfter -ne $manifestRow.source_sha256_before) {
            $manifestRow.status = 'SOURCE_HASH_MISMATCH'
            $manifestRow.last_error = 'SHA-256 исходного AI изменился после обработки.'
            continue
        }

        if ($batchRow.status -eq 'OK') {
            foreach ($outputPath in @($batchRow.output_ai, $batchRow.output_png)) {
                if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf) -or
                    (Get-Item -LiteralPath $outputPath).Length -le 0) {
                    throw "Строка OK ссылается на отсутствующий результат: $outputPath"
                }
            }
            $manifestRow.output_ai = [string]$batchRow.output_ai
            $manifestRow.output_png = [string]$batchRow.output_png
            $manifestRow.output_ai_sha256 = (
                Get-FileHash -LiteralPath $batchRow.output_ai -Algorithm SHA256
            ).Hash.ToLowerInvariant()
            $manifestRow.output_png_sha256 = (
                Get-FileHash -LiteralPath $batchRow.output_png -Algorithm SHA256
            ).Hash.ToLowerInvariant()
            $manifestRow.status = 'PROCESSED_OK'
            $manifestRow.last_error = ''
        } else {
            $manifestRow.status = 'ERROR'
            $manifestRow.output_ai = ''
            $manifestRow.output_png = ''
            $manifestRow.output_ai_sha256 = ''
            $manifestRow.output_png_sha256 = ''
        }
    }

    Write-Utf8Csv -Path $manifestPath -Rows $manifestRows
    $manifestSnapshot = Join-Path $batchRoot "manifest_after_${batchId}.csv"
    Write-Utf8Csv -Path $manifestSnapshot -Rows $manifestRows
    $aggregateReport = Update-AggregateReport -DiagnosticsRoot $diagnosticsRoot
    Update-RunSummary -SummaryPath $summaryPath -ManifestRows $manifestRows -LastBatch $batchId

    $hashMismatches = @(
        $manifestRows |
            Where-Object status -eq 'SOURCE_HASH_MISMATCH'
    )
    if ($hashMismatches.Count -gt 0) {
        throw "Обнаружено изменение SHA-256 исходников; дальнейшая обработка остановлена."
    }
    if ($illustratorError) {
        throw "Illustrator завершил пакет с ошибкой: $($illustratorError.Exception.Message)"
    }

    [pscustomobject]@{
        RunId = $RunIdValue
        BatchId = $batchId
        Selected = $eligible.Count
        ProcessedOk = @($batchRows | Where-Object status -eq 'OK').Count
        Errors = @($batchRows | Where-Object status -eq 'ERROR').Count
        Illustrator = $illustratorResult
        BatchReport = $batchReportPath
        AggregateReport = $aggregateReport
        Manifest = $manifestPath
        ManifestSnapshot = $manifestSnapshot
    }
}

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\..\..\LIBRARY\02_CATALOG\02_PRESALE_Поздняково\01_ARTIFACTS\МКД2')
)

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Корень источников не найден: $sourceRoot"
}

switch ($Stage) {
    'Initialize' {
        Initialize-Run -Workspace $workspace -SourceRoot $sourceRoot -RunIdValue $RunId
    }
    'Process' {
        Process-RunBatch `
            -Workspace $workspace `
            -RunIdValue $RunId `
            -StartIndexValue $StartIndex `
            -MaxFilesValue $MaxFiles
    }
}
