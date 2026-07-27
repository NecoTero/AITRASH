[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RunId,

    [ValidateRange(0, 1000000)]
    [int]$StartIndex = 0,

    [ValidateRange(1, 1000)]
    [int]$MaxFiles = 25
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
    if ($Rows.Count -eq 0) {
        throw "Нельзя записать пустой CSV: $Path"
    }
    $lines = @($Rows | ConvertTo-Csv -NoTypeInformation)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllLines($Path, $lines, $encoding)
}

function Add-ColumnIfMissing {
    param([object[]]$Rows, [string]$Name)
    foreach ($row in $Rows) {
        if (-not $row.PSObject.Properties[$Name]) {
            $row | Add-Member -NotePropertyName $Name -NotePropertyValue ''
        }
    }
}

function Get-IndependentScale {
    param([double]$Width, [double]$Height)
    if ($Width -le 0 -or $Height -le 0) {
        throw "Некорректные visibleBounds: ${Width}x${Height}"
    }
    $rawByArea = [Math]::Sqrt(777500.0 / ($Width * $Height))
    $rawBySide = 1070.0 / [Math]::Max($Width, $Height)
    $raw = [Math]::Min($rawByArea, $rawBySide)
    $bestScale = $null
    $bestGap = [double]::PositiveInfinity
    foreach ($scale in @(100, 110, 120, 150, 170, 200)) {
        if (($Width * $scale / 100.0) -gt 1200.02 -or
            ($Height * $scale / 100.0) -gt 1200.02) {
            continue
        }
        $gap = [Math]::Abs(($scale / 100.0) - $raw)
        if ($null -eq $bestScale -or $gap -lt ($bestGap - 1e-9) -or
            ([Math]::Abs($gap - $bestGap) -le 1e-9 -and $scale -lt $bestScale)) {
            $bestScale = $scale
            $bestGap = $gap
        }
    }
    if ($null -eq $bestScale) {
        throw "Не найден допустимый масштаб для ${Width}x${Height}"
    }
    [pscustomobject]@{
        RawByArea = [Math]::Round($rawByArea, 9)
        RawBySide = [Math]::Round($rawBySide, 9)
        Raw = [Math]::Round($raw, 9)
        Scale = [int]$bestScale
    }
}

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$diagnosticsRoot = Join-Path $workspace "09_outputs\_diagnostics\full_$RunId"
$manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
$summaryPath = Join-Path $diagnosticsRoot 'summary.json'
$analysisRoot = Join-Path $diagnosticsRoot 'preflight_batches'
$analysisReportPath = Join-Path $diagnosticsRoot 'preflight_report.csv'
$analysisSummaryPath = Join-Path $diagnosticsRoot 'preflight_summary.json'
$scriptPath = Join-Path $PSScriptRoot 'presale_site_analyze.jsx'
$activeJobPath = Join-Path $PSScriptRoot 'presale_site_analyze_job.json'

foreach ($required in @($manifestPath, $summaryPath, $scriptPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Не найден обязательный файл: $required"
    }
}
[System.IO.Directory]::CreateDirectory($analysisRoot) | Out-Null

$manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
if ($manifestRows.Count -ne 388) {
    throw "Manifest должен содержать 388 строк."
}

$columns = @(
    'preflight_status',
    'preflight_visible_width',
    'preflight_visible_height',
    'preflight_s_raw',
    'preflight_scale_percent',
    'preflight_page_items',
    'preflight_root_items',
    'preflight_top_layers',
    'preflight_total_layers',
    'preflight_nested_layers',
    'preflight_empty_layers',
    'preflight_duplicate_sibling_names',
    'preflight_max_layer_depth',
    'preflight_error'
)
foreach ($column in $columns) {
    Add-ColumnIfMissing -Rows $manifestRows -Name $column
}

$eligible = @(
    $manifestRows |
        Where-Object {
            [int]$_.index -ge $StartIndex -and
            $_.preflight_status -ne 'OK'
        } |
        Sort-Object { [int]$_.index } |
        Select-Object -First $MaxFiles
)
if ($eligible.Count -eq 0) {
    [pscustomobject]@{
        RunId = $RunId
        Selected = 0
        Message = 'Нет непроверенных строк в заданном диапазоне.'
    }
    exit 0
}

$batchId = '{0:D3}_{1:D3}_{2}' -f (
    [int]$eligible[0].index
), (
    [int]$eligible[-1].index
), (
    Get-Date -Format 'yyyyMMdd_HHmmss'
)
$batchReportPath = Join-Path $analysisRoot "preflight_${batchId}_report.csv"
$jobArchivePath = Join-Path $analysisRoot "preflight_${batchId}_job.json"
$manifestSnapshotPath = Join-Path $analysisRoot "manifest_after_preflight_${batchId}.csv"

$job = [ordered]@{
    schema_version = 1
    run_id = $RunId
    batch_id = $batchId
    created_at = (Get-Date).ToString('s')
    batch_report = $batchReportPath
    entries = @(
        $eligible | ForEach-Object {
            [ordered]@{
                index = [int]$_.index
                source_relpath = [string]$_.source_relpath
                source_ai = [string]$_.source_ai
            }
        }
    )
}
$jobText = $job | ConvertTo-Json -Depth 6
Write-Utf8Text -Path $jobArchivePath -Text $jobText
Write-Utf8Text -Path $activeJobPath -Text $jobText

$illustrator = New-Object -ComObject Illustrator.Application
$illustratorVersion = [string]$illustrator.Version
$illustratorResult = [string]$illustrator.DoJavaScriptFile($scriptPath)
if (-not (Test-Path -LiteralPath $batchReportPath -PathType Leaf)) {
    throw "Illustrator не создал preflight report: $illustratorResult"
}

$batchRows = @(Import-Csv -LiteralPath $batchReportPath -Encoding UTF8)
if ($batchRows.Count -ne $eligible.Count) {
    throw "Preflight report содержит $($batchRows.Count) строк вместо $($eligible.Count)."
}
$duplicateIndices = @($batchRows | Group-Object index | Where-Object Count -ne 1)
if ($duplicateIndices.Count -ne 0) {
    throw "Preflight report содержит повторяющиеся индексы."
}

foreach ($batchRow in $batchRows) {
    $manifestRow = $manifestRows |
        Where-Object { [int]$_.index -eq [int]$batchRow.index } |
        Select-Object -First 1
    if (-not $manifestRow) {
        throw "Неизвестный индекс в preflight report: $($batchRow.index)"
    }
    $manifestRow.preflight_status = [string]$batchRow.status
    $manifestRow.preflight_page_items = [string]$batchRow.page_items
    $manifestRow.preflight_root_items = [string]$batchRow.root_items
    $manifestRow.preflight_top_layers = [string]$batchRow.top_layers
    $manifestRow.preflight_total_layers = [string]$batchRow.total_layers
    $manifestRow.preflight_nested_layers = [string]$batchRow.nested_layers
    $manifestRow.preflight_empty_layers = [string]$batchRow.empty_layers
    $manifestRow.preflight_duplicate_sibling_names =
        [string]$batchRow.duplicate_sibling_names
    $manifestRow.preflight_max_layer_depth = [string]$batchRow.max_layer_depth
    $manifestRow.preflight_error = [string]$batchRow.comment
    if ($batchRow.status -eq 'OK') {
        try {
            $width = [double]::Parse(
                [string]$batchRow.visible_width,
                [Globalization.CultureInfo]::InvariantCulture
            )
            $height = [double]::Parse(
                [string]$batchRow.visible_height,
                [Globalization.CultureInfo]::InvariantCulture
            )
            $scale = Get-IndependentScale -Width $width -Height $height
            $manifestRow.preflight_visible_width = [string]$width
            $manifestRow.preflight_visible_height = [string]$height
            $manifestRow.preflight_s_raw = [string]$scale.Raw
            $manifestRow.preflight_scale_percent = [string]$scale.Scale
            $manifestRow.preflight_error = ''
        } catch {
            $manifestRow.preflight_status = 'ERROR'
            $manifestRow.preflight_error = $_.Exception.Message
        }
    }
}

Write-Utf8Csv -Path $manifestPath -Rows $manifestRows
Write-Utf8Csv -Path $manifestSnapshotPath -Rows $manifestRows

$preflightRows = @(
    $manifestRows | ForEach-Object {
        [pscustomobject][ordered]@{
            index = $_.index
            corpus = $_.corpus
            source_relpath = $_.source_relpath
            status = $_.preflight_status
            width = $_.preflight_visible_width
            height = $_.preflight_visible_height
            s_raw = $_.preflight_s_raw
            scale_percent = $_.preflight_scale_percent
            page_items = $_.preflight_page_items
            root_items = $_.preflight_root_items
            top_layers = $_.preflight_top_layers
            total_layers = $_.preflight_total_layers
            nested_layers = $_.preflight_nested_layers
            empty_layers = $_.preflight_empty_layers
            duplicate_sibling_names = $_.preflight_duplicate_sibling_names
            max_layer_depth = $_.preflight_max_layer_depth
            error = $_.preflight_error
        }
    }
)
Write-Utf8Csv -Path $analysisReportPath -Rows $preflightRows

$okRows = @($manifestRows | Where-Object preflight_status -eq 'OK')
$errorRows = @(
    $manifestRows |
        Where-Object {
            $_.preflight_status -and $_.preflight_status -ne 'OK'
        }
)
$pendingRows = @(
    $manifestRows |
        Where-Object { -not $_.preflight_status }
)
$distribution = @(
    $okRows |
        Group-Object corpus, preflight_scale_percent |
        ForEach-Object {
            [pscustomobject]@{
                corpus = $_.Group[0].corpus
                scale_percent = [int]$_.Group[0].preflight_scale_percent
                count = $_.Count
            }
        } |
        Sort-Object corpus, scale_percent
)
$nestedDocuments = @(
    $okRows | Where-Object { [int]$_.preflight_nested_layers -gt 0 }
)
$emptyLayerDocuments = @(
    $okRows | Where-Object { [int]$_.preflight_empty_layers -gt 0 }
)
$duplicateLayerDocuments = @(
    $okRows |
        Where-Object { [int]$_.preflight_duplicate_sibling_names -gt 0 }
)

$accepted = $false
$acceptanceErrors = New-Object System.Collections.Generic.List[string]
if ($okRows.Count -eq 388 -and $errorRows.Count -eq 0 -and $pendingRows.Count -eq 0) {
    $expectedByCorpus = @{
        'Корпус 2.1' = @{ 100 = 0; 110 = 3; 120 = 17; 150 = 12; 170 = 87; 200 = 38 }
        'Корпус 2.2' = @{ 100 = 0; 110 = 3; 120 = 11; 150 = 2; 170 = 27; 200 = 10 }
        'Корпус 2.3' = @{ 100 = 2; 110 = 11; 120 = 18; 150 = 29; 170 = 44; 200 = 74 }
    }
    foreach ($corpus in $expectedByCorpus.Keys) {
        foreach ($scale in $expectedByCorpus[$corpus].Keys) {
            $actual = @(
                $okRows |
                    Where-Object {
                        $_.corpus -eq $corpus -and
                        [int]$_.preflight_scale_percent -eq [int]$scale
                    }
            ).Count
            if ($actual -ne $expectedByCorpus[$corpus][$scale]) {
                $acceptanceErrors.Add(
                    "$corpus ${scale}%: ожидалось $($expectedByCorpus[$corpus][$scale]), фактически $actual"
                )
            }
        }
    }
    $hundredPaths = @(
        $okRows |
            Where-Object { [int]$_.preflight_scale_percent -eq 100 } |
            Select-Object -ExpandProperty source_relpath
    )
    $expectedHundred = @(
        'Корпус 2.3/POZD_WEB_K2-3_s9_et5_5.ai',
        'Корпус 2.3/POZD_WEB_K2-3_s10_et6_6.ai'
    )
    if (@($hundredPaths | Where-Object { $expectedHundred -notcontains $_ }).Count -ne 0 -or
        @($expectedHundred | Where-Object { $hundredPaths -notcontains $_ }).Count -ne 0) {
        $acceptanceErrors.Add('Набор двух планировок 100% не совпал.')
    }
    $accepted = $acceptanceErrors.Count -eq 0
}

$preflightSummary = [ordered]@{
    schema_version = 1
    run_id = $RunId
    updated_at = (Get-Date).ToString('s')
    illustrator_version = $illustratorVersion
    same_session_pid = (Get-Process Illustrator -ErrorAction SilentlyContinue).Id
    analyzed_ok = $okRows.Count
    errors = $errorRows.Count
    pending = $pendingRows.Count
    distribution = $distribution
    nested_layer_documents = $nestedDocuments.Count
    empty_layer_documents = $emptyLayerDocuments.Count
    duplicate_sibling_layer_documents = $duplicateLayerDocuments.Count
    accepted_distribution = $accepted
    acceptance_errors = $acceptanceErrors.ToArray()
    report = $analysisReportPath
}
Write-Utf8Text -Path $analysisSummaryPath -Text (
    $preflightSummary | ConvertTo-Json -Depth 8
)

$runSummary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
$runSummary.stage = if ($accepted) { 'preflight_accepted' } else { 'preflight' }
$runSummary | Add-Member -NotePropertyName preflight -NotePropertyValue (
    $preflightSummary
) -Force
Write-Utf8Text -Path $summaryPath -Text ($runSummary | ConvertTo-Json -Depth 12)

[pscustomobject]@{
    RunId = $RunId
    BatchId = $batchId
    Selected = $eligible.Count
    AnalyzedOk = @($batchRows | Where-Object status -eq 'OK').Count
    BatchErrors = @($batchRows | Where-Object status -ne 'OK').Count
    TotalOk = $okRows.Count
    TotalErrors = $errorRows.Count
    TotalPending = $pendingRows.Count
    NestedLayerDocuments = $nestedDocuments.Count
    EmptyLayerDocuments = $emptyLayerDocuments.Count
    DuplicateSiblingLayerDocuments = $duplicateLayerDocuments.Count
    DistributionAccepted = $accepted
    IllustratorVersion = $illustratorVersion
    IllustratorResult = $illustratorResult
    PreflightReport = $analysisReportPath
    PreflightSummary = $analysisSummaryPath
}
