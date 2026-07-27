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

function Add-AcceptanceError {
    param(
        [System.Collections.Generic.List[string]]$Errors,
        [string]$Message
    )
    $Errors.Add($Message)
}

function Test-SamePath {
    param(
        [string]$Left,
        [string]$Right
    )
    if (-not $Left -or -not $Right) {
        return $false
    }
    try {
        $leftFull = [System.IO.Path]::GetFullPath($Left)
        $rightFull = [System.IO.Path]::GetFullPath($Right)
        return [string]::Equals(
            $leftFull,
            $rightFull,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    } catch {
        return $false
    }
}

function Test-StrictTrue {
    param([object]$Value)
    return $Value -is [bool] -and $Value
}

function Test-ChildPath {
    param(
        [string]$Root,
        [string]$Path
    )
    if (-not $Root -or -not $Path) {
        return $false
    }
    try {
        $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
        $pathFull = [System.IO.Path]::GetFullPath($Path)
        return $pathFull.StartsWith(
            $rootFull,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    } catch {
        return $false
    }
}

function Get-VerifyAttempt {
    param([object]$Row)
    $auditName = [System.IO.Path]::GetFileName([string]$Row.verify_audit)
    if ($auditName -match 'verify_attempt(?<attempt>\d+)\.json$') {
        return [int]$Matches.attempt
    }
    return 0
}

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$scaleOverridesPath = Join-Path $PSScriptRoot 'scale_overrides.csv'
$diagnosticsRoot = Join-Path $workspace "09_outputs\_diagnostics\full_$RunId"
$outputRoot = Join-Path $workspace "09_outputs\_full_wip\$RunId"
$manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
$processReportPath = Join-Path $diagnosticsRoot 'report.csv'
$summaryPath = Join-Path $diagnosticsRoot 'summary.json'
$preflightSummaryPath = Join-Path $diagnosticsRoot 'preflight_summary.json'
$processingProgressPath = Join-Path $diagnosticsRoot 'processing_progress.json'
$legacyGeometryPath = Join-Path $diagnosticsRoot `
    'legacy_geometry_reprocess.json'
$enhancedReverifyPath = Join-Path $diagnosticsRoot `
    'enhanced_reverify_progress.json'
$verifyReportPath = Join-Path $diagnosticsRoot 'verify_report.csv'
$pngAcceptanceReportPath = Join-Path $diagnosticsRoot 'png_acceptance.csv'
$pngAcceptancePath = Join-Path $diagnosticsRoot 'png_acceptance.json'
$visualReviewPath = Join-Path $diagnosticsRoot 'visual_review.json'
$contactRoot = Join-Path $diagnosticsRoot 'contact_sheets'
$contactManifestPath = Join-Path $contactRoot 'contact_sheet_manifest.csv'
$acceptancePath = Join-Path $diagnosticsRoot 'final_acceptance.json'
$errors = New-Object System.Collections.Generic.List[string]

foreach ($required in @(
    $scaleOverridesPath,
    $manifestPath,
    $processReportPath,
    $summaryPath,
    $preflightSummaryPath,
    $processingProgressPath,
    $legacyGeometryPath,
    $enhancedReverifyPath,
    $verifyReportPath,
    $pngAcceptanceReportPath,
    $pngAcceptancePath,
    $contactManifestPath,
    $visualReviewPath
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        Add-AcceptanceError -Errors $errors -Message (
            "Не найден обязательный файл: $required"
        )
    }
}

$manifestRows = @()
$runSummary = $null
$scaleOverrides = @()
$processRows = @()
$latestProcessRows = @()
$verifyRows = @()
$latestVerifyRows = @()
$preflightSummary = $null
$processingProgress = $null
$legacyGeometry = $null
$enhancedReverify = $null
$pngAcceptanceRows = @()
$pngAcceptance = $null
$visualReview = $null
$contactRows = @()

if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
}
if (Test-Path -LiteralPath $summaryPath -PathType Leaf) {
    $runSummary = Get-Content -LiteralPath $summaryPath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
}
if (Test-Path -LiteralPath $scaleOverridesPath -PathType Leaf) {
    $scaleOverrides = @(
        Import-Csv -LiteralPath $scaleOverridesPath -Encoding UTF8
    )
}
if (Test-Path -LiteralPath $processReportPath -PathType Leaf) {
    $processRows = @(Import-Csv -LiteralPath $processReportPath -Encoding UTF8)
    $latestProcessRows = @(
        $processRows |
            Group-Object index |
            ForEach-Object {
                $_.Group |
                    Sort-Object { [int]$_.attempt } |
                    Select-Object -Last 1
            }
    )
}
if (Test-Path -LiteralPath $verifyReportPath -PathType Leaf) {
    $verifyRows = @(Import-Csv -LiteralPath $verifyReportPath -Encoding UTF8)
    $latestVerifyRows = @(
        $verifyRows |
            Group-Object index |
            ForEach-Object {
                $_.Group |
                    Sort-Object { Get-VerifyAttempt -Row $_ } |
                    Select-Object -Last 1
            }
    )
}
if (Test-Path -LiteralPath $preflightSummaryPath -PathType Leaf) {
    $preflightSummary = Get-Content -LiteralPath $preflightSummaryPath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
}
if (Test-Path -LiteralPath $processingProgressPath -PathType Leaf) {
    $processingProgress = Get-Content -LiteralPath $processingProgressPath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
}
if (Test-Path -LiteralPath $legacyGeometryPath -PathType Leaf) {
    $legacyGeometry = Get-Content -LiteralPath $legacyGeometryPath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
}
if (Test-Path -LiteralPath $enhancedReverifyPath -PathType Leaf) {
    $enhancedReverify = Get-Content -LiteralPath $enhancedReverifyPath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
}
if (Test-Path -LiteralPath $pngAcceptancePath -PathType Leaf) {
    $pngAcceptance = Get-Content -LiteralPath $pngAcceptancePath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
}
if (Test-Path -LiteralPath $pngAcceptanceReportPath -PathType Leaf) {
    $pngAcceptanceRows = @(
        Import-Csv -LiteralPath $pngAcceptanceReportPath -Encoding UTF8
    )
}
if (Test-Path -LiteralPath $visualReviewPath -PathType Leaf) {
    $visualReview = Get-Content -LiteralPath $visualReviewPath `
        -Raw -Encoding UTF8 | ConvertFrom-Json
}
if (Test-Path -LiteralPath $contactManifestPath -PathType Leaf) {
    $contactRows = @(Import-Csv -LiteralPath $contactManifestPath -Encoding UTF8)
}

if ($manifestRows.Count -ne 388) {
    Add-AcceptanceError -Errors $errors -Message (
        "Manifest: ожидалось 388 строк, фактически $($manifestRows.Count)."
    )
}
$duplicateSources = @(
    $manifestRows |
        Group-Object source_relpath |
        Where-Object Count -ne 1
)
if ($duplicateSources.Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Manifest содержит повторяющиеся source_relpath."
    )
}

if (-not $runSummary -or
    $runSummary.run_id -ne $RunId -or
    [int]$runSummary.total_ai -ne 388 -or
    [int]$runSummary.total_reference_png -ne 388 -or
    [int]$runSummary.overrides -ne 0 -or
    [int]$runSummary.excluded_nested_or_other_ai -ne 9 -or
    @($runSummary.inventory).Count -ne 3) {
    Add-AcceptanceError -Errors $errors -Message (
        "Summary inventory не подтвердил 388 AI/388 PNG/0 overrides/9 excluded."
    )
}
if ($scaleOverrides.Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Для этого фиксированного прогона scale_overrides.csv должен быть пуст."
    )
}

$sourceRoot = if ($runSummary) {
    [string]$runSummary.source_root
} else {
    ''
}
foreach ($row in $manifestRows) {
    $expectedSourceDirectory = if ($sourceRoot) {
        Join-Path $sourceRoot $row.corpus
    } else {
        ''
    }
    $expectedReference = if ($row.source_ai) {
        [System.IO.Path]::ChangeExtension([string]$row.source_ai, '.png')
    } else {
        ''
    }
    if ($row.source_relpath -notmatch
            '^Корпус 2\.[123]/[^/\\]+\.ai$' -or
        $row.source_relpath -match
            '(?i:Коммерческие ОН|без[\s_-]*мебел)' -or
        -not $expectedSourceDirectory -or
        -not (Test-SamePath `
            -Left ([System.IO.Path]::GetDirectoryName([string]$row.source_ai)) `
            -Right $expectedSourceDirectory) -or
        -not (Test-SamePath -Left $row.reference_png `
            -Right $expectedReference) -or
        -not (Test-Path -LiteralPath $row.reference_png -PathType Leaf)) {
        Add-AcceptanceError -Errors $errors -Message (
            "Источник вне разрешённого верхнего уровня или PNG не парный: " +
            "$($row.source_relpath)"
        )
    }
}

$expectedCorpusCounts = @{
    'Корпус 2.1' = 157
    'Корпус 2.2' = 53
    'Корпус 2.3' = 178
}
foreach ($corpus in $expectedCorpusCounts.Keys) {
    $actual = @($manifestRows | Where-Object corpus -eq $corpus).Count
    if ($actual -ne $expectedCorpusCounts[$corpus]) {
        Add-AcceptanceError -Errors $errors -Message (
            "${corpus}: ожидалось $($expectedCorpusCounts[$corpus]), фактически $actual."
        )
    }
}

$nonOk = @($manifestRows | Where-Object status -ne 'OK')
if ($nonOk.Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Manifest содержит $($nonOk.Count) строк со статусом не OK."
    )
}

if ($latestProcessRows.Count -ne 388) {
    Add-AcceptanceError -Errors $errors -Message (
        "Последних process-строк: ожидалось 388, фактически $($latestProcessRows.Count)."
    )
}
$latestProcessErrors = @($latestProcessRows | Where-Object status -ne 'OK')
if ($latestProcessErrors.Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Последний process-результат не OK для $($latestProcessErrors.Count) файлов."
    )
}

if (-not $preflightSummary -or
    [string]$preflightSummary.run_id -ne $RunId -or
    -not (Test-StrictTrue $preflightSummary.accepted_distribution) -or
    [int]$preflightSummary.analyzed_ok -ne 388 -or
    [int]$preflightSummary.errors -ne 0 -or
    [int]$preflightSummary.pending -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Read-only preflight не имеет полной принятой конфигурации 388/0/0."
    )
}

if (-not $processingProgress -or
    $processingProgress.run_id -ne $RunId -or
    $processingProgress.status -ne 'completed' -or
    [int]$processingProgress.ok -ne 388 -or
    [int]$processingProgress.remaining -ne 0 -or
    [int]$processingProgress.statuses.OK -ne 388 -or
    [int]$processingProgress.statuses.ERROR -ne 0 -or
    [int]$processingProgress.statuses.PROCESSED_OK -ne 0 -or
    [int]$processingProgress.statuses.VERIFY_ERROR -ne 0 -or
    [int]$processingProgress.statuses.SOURCE_HASH_MISMATCH -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Оркестратор не подтвердил completed/388 OK/0 remaining/0 errors."
    )
}
if ($preflightSummary -and $processingProgress -and
    [int]$preflightSummary.same_session_pid -ne
        [int]$processingProgress.illustrator_pid) {
    Add-AcceptanceError -Errors $errors -Message (
        "PID Illustrator preflight и обработки не совпал."
    )
}
if ($processingProgress) {
    $illustratorProcesses = @(
        Get-Process -Name Illustrator -ErrorAction SilentlyContinue
    )
    if ($illustratorProcesses.Count -ne 1 -or
        $illustratorProcesses[0].Id -ne
            [int]$processingProgress.illustrator_pid -or
        -not $illustratorProcesses[0].Responding) {
        Add-AcceptanceError -Errors $errors -Message (
            "Исходный единственный сеанс Illustrator не найден или не отвечает."
        )
    }
}
$expectedLegacyIndices = @(38, 68, 164, 168, 233, 355, 384)
if (-not $legacyGeometry -or
    $legacyGeometry.run_id -ne $RunId -or
    $legacyGeometry.status -ne 'completed' -or
    [int]$legacyGeometry.completed -ne 7 -or
    [int]$legacyGeometry.remaining -ne 0 -or
    [int]$legacyGeometry.illustrator_pid -ne
        [int]$preflightSummary.same_session_pid -or
    @($legacyGeometry.required_indices).Count -ne 7 -or
    @($legacyGeometry.completed_indices).Count -ne 7 -or
    @(
        $expectedLegacyIndices |
            Where-Object {
                @($legacyGeometry.completed_indices) -notcontains $_
            }
    ).Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Семь legacy pilot-файлов не получили новый boolean geometry proof."
    )
}
if (-not $enhancedReverify -or
    $enhancedReverify.run_id -ne $RunId -or
    $enhancedReverify.status -ne 'completed' -or
    [int]$enhancedReverify.ok -ne 388 -or
    [int]$enhancedReverify.remaining -ne 0 -or
    [int]$enhancedReverify.verify_errors -ne 0 -or
    [int]$enhancedReverify.illustrator_pid -ne
        [int]$preflightSummary.same_session_pid -or
    $enhancedReverify.verifier -ne
        '1.1.0-independent-full-ancestry') {
    Add-AcceptanceError -Errors $errors -Message (
        "Усиленный повторный AI verify 388/388 не подтверждён."
    )
}

$expectedScaleCounts = @{
    100 = 2
    110 = 17
    120 = 46
    150 = 43
    170 = 158
    200 = 122
}
foreach ($scale in $expectedScaleCounts.Keys) {
    $actual = @(
        $manifestRows |
            Where-Object { [int]$_.applied_scale_percent -eq [int]$scale }
    ).Count
    if ($actual -ne $expectedScaleCounts[$scale]) {
        Add-AcceptanceError -Errors $errors -Message (
            "Масштаб ${scale}%: ожидалось $($expectedScaleCounts[$scale]), фактически $actual."
        )
    }
}
if (@(
    $manifestRows |
        Where-Object { [int]$_.applied_scale_percent -eq 140 }
).Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message 'Обнаружен запрещённый масштаб 140%.'
}

$hundredPaths = @(
    $manifestRows |
        Where-Object { [int]$_.applied_scale_percent -eq 100 } |
        Select-Object -ExpandProperty source_relpath
)
$expectedHundred = @(
    'Корпус 2.3/POZD_WEB_K2-3_s9_et5_5.ai',
    'Корпус 2.3/POZD_WEB_K2-3_s10_et6_6.ai'
)
if (@($hundredPaths | Where-Object { $expectedHundred -notcontains $_ }).Count -ne 0 -or
    @($expectedHundred | Where-Object { $hundredPaths -notcontains $_ }).Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Набор двух планировок 100% не совпал."
    )
}

if ($latestVerifyRows.Count -ne 388) {
    Add-AcceptanceError -Errors $errors -Message (
        "Последних verify-строк: ожидалось 388, фактически $($latestVerifyRows.Count)."
    )
}
$latestVerifyErrors = @($latestVerifyRows | Where-Object status -ne 'OK')
if ($latestVerifyErrors.Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Последний verify-результат не OK для $($latestVerifyErrors.Count) файлов."
    )
}

$outputAiFiles = @()
$outputPngFiles = @()
if (Test-Path -LiteralPath $outputRoot -PathType Container) {
    $outputAiFiles = @(
        Get-ChildItem -LiteralPath $outputRoot -File -Recurse -Filter '*.ai'
    )
    $outputPngFiles = @(
        Get-ChildItem -LiteralPath $outputRoot -File -Recurse -Filter '*.png'
    )
}
if ($outputAiFiles.Count -ne 388 -or $outputPngFiles.Count -ne 388) {
    Add-AcceptanceError -Errors $errors -Message (
        "В output найдено AI=$($outputAiFiles.Count), PNG=$($outputPngFiles.Count), ожидалось 388/388."
    )
}

$duplicateOutputAi = @(
    $manifestRows |
        Group-Object output_ai |
        Where-Object { $_.Name -and $_.Count -ne 1 }
)
$duplicateOutputPng = @(
    $manifestRows |
        Group-Object output_png |
        Where-Object { $_.Name -and $_.Count -ne 1 }
)
if ($duplicateOutputAi.Count -ne 0 -or $duplicateOutputPng.Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Manifest содержит повторяющиеся пути выходных AI/PNG."
    )
}

$checkedRows = 0
foreach ($row in $manifestRows) {
    if ($row.status -ne 'OK') {
        continue
    }
    $checkedRows += 1
    if ($row.preflight_status -ne 'OK' -or
        [int]$row.preflight_scale_percent -ne
            [int]$row.applied_scale_percent) {
        Add-AcceptanceError -Errors $errors -Message (
            "Preflight/scale mismatch: $($row.source_relpath)"
        )
        continue
    }
    $process = $latestProcessRows |
        Where-Object { [int]$_.index -eq [int]$row.index } |
        Select-Object -First 1
    if (-not $process) {
        Add-AcceptanceError -Errors $errors -Message (
            "Нет process-строки: $($row.source_relpath)"
        )
        continue
    }
    if ($process.status -ne 'OK' -or
        $process.source_relpath -ne $row.source_relpath -or
        [int]$process.applied_scale_percent -ne
            [int]$row.applied_scale_percent -or
        [int]$process.stroke_mismatch_count -ne 0 -or
        [Math]::Abs([double]$process.final_center_x - 600) -gt 0.02 -or
        [Math]::Abs([double]$process.final_center_y - 600) -gt 0.02 -or
        [string]$process.layer_state_match -notmatch '^(?i:true)$' -or
        [string]$process.item_state_match -notmatch '^(?i:true)$' -or
        [string]$process.item_structure_match -notmatch '^(?i:true)$' -or
        [string]$process.item_geometry_match_after_reopen -notmatch
            '^(?i:true)$' -or
        [string]$process.ruler_units_pixels_after_reopen -notmatch
            '^(?i:true)$' -or
        -not (Test-SamePath -Left $process.source_ai -Right $row.source_ai) -or
        -not (Test-SamePath -Left $process.output_ai -Right $row.output_ai) -or
        -not (Test-SamePath -Left $process.output_png -Right $row.output_png) -or
        -not (Test-SamePath -Left $process.audit_json -Right $row.audit_json)) {
        Add-AcceptanceError -Errors $errors -Message (
            "Process identity mismatch: $($row.source_relpath)"
        )
    }
    if (-not (Test-Path -LiteralPath $row.source_ai -PathType Leaf)) {
        Add-AcceptanceError -Errors $errors -Message (
            "Нет исходника: $($row.source_relpath)"
        )
        continue
    }
    $sourceHash = (
        Get-FileHash -LiteralPath $row.source_ai -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($sourceHash -ne $row.source_sha256_before -or
        $sourceHash -ne $row.source_sha256_after) {
        Add-AcceptanceError -Errors $errors -Message (
            "SHA-256 исходника не совпал: $($row.source_relpath)"
        )
    }
    foreach ($outputField in @(
        @{ Path = $row.output_ai; Hash = $row.output_ai_sha256; Kind = 'AI' },
        @{ Path = $row.output_png; Hash = $row.output_png_sha256; Kind = 'PNG' }
    )) {
        if (-not (Test-ChildPath -Root $outputRoot -Path $outputField.Path)) {
            Add-AcceptanceError -Errors $errors -Message (
                "Путь output $($outputField.Kind) вне текущего outputRoot: " +
                $row.source_relpath
            )
            continue
        }
        if (-not (Test-Path -LiteralPath $outputField.Path -PathType Leaf)) {
            Add-AcceptanceError -Errors $errors -Message (
                "Нет output $($outputField.Kind): $($row.source_relpath)"
            )
        } else {
            $actualHash = (
                Get-FileHash -LiteralPath $outputField.Path -Algorithm SHA256
            ).Hash.ToLowerInvariant()
            if ($actualHash -ne $outputField.Hash) {
                Add-AcceptanceError -Errors $errors -Message (
                    "SHA-256 output $($outputField.Kind) не совпал: $($row.source_relpath)"
                )
            }
        }
    }
    if (-not (Test-Path -LiteralPath $row.audit_json -PathType Leaf)) {
        Add-AcceptanceError -Errors $errors -Message (
            "Нет process audit: $($row.source_relpath)"
        )
    } else {
        try {
            $audit = Get-Content -LiteralPath $row.audit_json `
                -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($audit.status -ne 'OK' -or
                $audit.run_id -ne $RunId -or
                [int]$audit.index -ne [int]$row.index -or
                $audit.source_relpath -ne $row.source_relpath -or
                [int]$audit.applied_scale_percent -ne
                    [int]$row.applied_scale_percent -or
                -not (Test-SamePath -Left $audit.source_ai -Right $row.source_ai) -or
                -not (Test-SamePath -Left $audit.output_ai -Right $row.output_ai) -or
                -not (Test-SamePath -Left $audit.output_png -Right $row.output_png) -or
                -not (Test-StrictTrue $audit.pixel_transfer.ruler_units_pixels) -or
                -not (Test-StrictTrue $audit.pixel_transfer.layer_signature_match) -or
                -not (Test-StrictTrue $audit.pixel_transfer.item_structure_match) -or
                -not (Test-StrictTrue $audit.pixel_transfer.item_state_match) -or
                -not (Test-StrictTrue $audit.pixel_transfer.item_geometry_match) -or
                -not (Test-StrictTrue $audit.pixel_transfer.visible_bounds_match) -or
                -not (Test-StrictTrue $audit.reopen_verification.ruler_units_pixels) -or
                -not (Test-StrictTrue $audit.reopen_verification.center_ok) -or
                -not (Test-StrictTrue $audit.reopen_verification.inside_artboard) -or
                -not (Test-StrictTrue $audit.reopen_verification.layer_signature_match) -or
                -not (Test-StrictTrue $audit.reopen_verification.item_structure_match) -or
                -not (Test-StrictTrue $audit.reopen_verification.item_state_match) -or
                -not (Test-StrictTrue $audit.reopen_verification.item_geometry_match) -or
                -not (Test-StrictTrue $audit.reopen_verification.color_space_match) -or
                [int]$audit.reopen_verification.stroke_mismatch_count -ne 0) {
                Add-AcceptanceError -Errors $errors -Message (
                    "Process audit не подтвердил Pixels/OK: $($row.source_relpath)"
                )
            }
        } catch {
            Add-AcceptanceError -Errors $errors -Message (
                "Process audit не читается: $($row.source_relpath)"
            )
        }
    }

    $verify = $latestVerifyRows |
        Where-Object { [int]$_.index -eq [int]$row.index } |
        Select-Object -First 1
    if (-not $verify) {
        Add-AcceptanceError -Errors $errors -Message (
            "Нет verify-строки: $($row.source_relpath)"
        )
        continue
    }
    if ($verify.status -ne 'OK' -or
        $verify.source_relpath -ne $row.source_relpath -or
        [int]$verify.applied_scale_percent -ne
            [int]$row.applied_scale_percent -or
        -not (Test-SamePath -Left $verify.output_ai -Right $row.output_ai) -or
        -not (Test-SamePath -Left $verify.output_png -Right $row.output_png) -or
        -not (Test-SamePath -Left $verify.process_audit -Right $row.audit_json)) {
        Add-AcceptanceError -Errors $errors -Message (
            "Verify identity mismatch: $($row.source_relpath)"
        )
    }
    $requiredTrueFields = @(
        'ruler_units_pixels',
        'inside_artboard',
        'layer_signature_match',
        'item_structure_match',
        'item_state_match',
        'color_space_match',
        'names_match',
        'pdf_compatible',
        'png_has_alpha',
        'png_corners_transparent',
        'png_no_opaque_white_rectangle',
        'source_hash_match',
        'output_ai_hash_match',
        'output_png_hash_match'
    )
    $verifyFailed = $verify.status -ne 'OK' -or
        [int]$verify.artboards -ne 1 -or
        [Math]::Abs([double]$verify.artboard_width - 1200) -gt 0.02 -or
        [Math]::Abs([double]$verify.artboard_height - 1200) -gt 0.02 -or
        [Math]::Abs([double]$verify.center_x - 600) -gt 0.02 -or
        [Math]::Abs([double]$verify.center_y - 600) -gt 0.02 -or
        [int]$verify.stroke_mismatch_count -ne 0 -or
        [int]$verify.png_width -ne 1200 -or
        [int]$verify.png_height -ne 1200
    foreach ($field in $requiredTrueFields) {
        if ([string]$verify.$field -notmatch '^(?i:true)$') {
            $verifyFailed = $true
        }
    }
    if ($verifyFailed) {
        Add-AcceptanceError -Errors $errors -Message (
            "Verify-критерии не пройдены: $($row.source_relpath)"
        )
    }
    if (-not (Test-Path -LiteralPath $verify.verify_audit -PathType Leaf)) {
        Add-AcceptanceError -Errors $errors -Message (
            "Нет verify audit: $($row.source_relpath)"
        )
    } else {
        try {
            $verifyAudit = Get-Content -LiteralPath $verify.verify_audit `
                -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($verifyAudit.status -ne 'OK' -or
                $verifyAudit.script_version -ne
                    '1.1.0-independent-full-ancestry' -or
                $verifyAudit.run_id -ne $RunId -or
                [int]$verifyAudit.index -ne [int]$row.index -or
                $verifyAudit.source_relpath -ne $row.source_relpath -or
                -not (Test-SamePath -Left $verifyAudit.source_ai -Right $row.source_ai) -or
                -not (Test-SamePath -Left $verifyAudit.output_ai -Right $row.output_ai) -or
                -not (Test-SamePath -Left $verifyAudit.output_png -Right $row.output_png) -or
                -not (Test-StrictTrue $verifyAudit.ruler_units_pixels) -or
                @($verifyAudit.artboards).Count -ne 1 -or
                [Math]::Abs(
                    [double]$verifyAudit.artboards[0].width - 1200
                ) -gt 0.02 -or
                [Math]::Abs(
                    [double]$verifyAudit.artboards[0].height - 1200
                ) -gt 0.02 -or
                [Math]::Abs(
                    [double]$verifyAudit.visible_bounds.center_x - 600
                ) -gt 0.02 -or
                [Math]::Abs(
                    [double]$verifyAudit.visible_bounds.center_y - 600
                ) -gt 0.02 -or
                -not (Test-StrictTrue $verifyAudit.inside_artboard) -or
                [int]$verifyAudit.stroke_mismatch_count -ne 0 -or
                [int]$verifyAudit.source_item_count -ne
                    [int]$verifyAudit.output_item_count -or
                [int]$verifyAudit.source_layer_count -ne
                    [int]$verifyAudit.output_layer_count -or
                -not (Test-StrictTrue $verifyAudit.layer_signature_match) -or
                -not (Test-StrictTrue $verifyAudit.item_structure_match) -or
                -not (Test-StrictTrue $verifyAudit.item_state_match) -or
                -not (Test-StrictTrue $verifyAudit.color_space_match) -or
                -not (Test-StrictTrue $verifyAudit.names_match)) {
                Add-AcceptanceError -Errors $errors -Message (
                    "Verify audit не подтвердил Pixels/OK: $($row.source_relpath)"
                )
            }
        } catch {
            Add-AcceptanceError -Errors $errors -Message (
                "Verify audit не читается: $($row.source_relpath)"
            )
        }
    }
}

if (-not $pngAcceptance -or
    $pngAcceptance.run_id -ne $RunId -or
    -not (Test-StrictTrue $pngAcceptance.accepted) -or
    [int]$pngAcceptance.inspected -ne 388 -or
    [int]$pngAcceptance.errors -ne 0 -or
    [int]$pngAcceptance.edge_frame_width_px -lt 16 -or
    -not (Test-StrictTrue $pngAcceptance.all_size_1200) -or
    -not (Test-StrictTrue $pngAcceptance.all_alpha_channel) -or
    -not (Test-StrictTrue $pngAcceptance.all_nonempty) -or
    -not (Test-StrictTrue $pngAcceptance.all_edge_frames_transparent) -or
    -not (Test-StrictTrue $pngAcceptance.all_no_opaque_artboard_background) -or
    -not (Test-StrictTrue $pngAcceptance.all_output_hashes_match)) {
    Add-AcceptanceError -Errors $errors -Message (
        "Усиленная PNG-приёмка 388 файлов не пройдена."
    )
}
$pngAcceptanceUnique = @($pngAcceptanceRows | Group-Object index)
if ($pngAcceptanceRows.Count -ne 388 -or
    $pngAcceptanceUnique.Count -ne 388 -or
    @($pngAcceptanceRows | Where-Object status -ne 'OK').Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "PNG acceptance report должен содержать 388 уникальных OK."
    )
}
foreach ($pngRow in $pngAcceptanceRows) {
    $manifestRow = $manifestRows |
        Where-Object { [int]$_.index -eq [int]$pngRow.index } |
        Select-Object -First 1
    if (-not $manifestRow -or
        $pngRow.source_relpath -ne $manifestRow.source_relpath -or
        -not (Test-SamePath -Left $pngRow.output_png `
            -Right $manifestRow.output_png) -or
        [int]$pngRow.width -ne 1200 -or
        [int]$pngRow.height -ne 1200 -or
        [long]$pngRow.transparent_pixels -le 0 -or
        [long]$pngRow.nontransparent_pixels -le 0 -or
        [long]$pngRow.edge_frame_nontransparent_pixels -ne 0 -or
        [string]$pngRow.has_alpha_channel -notmatch '^(?i:true)$' -or
        [string]$pngRow.edge_frame_transparent -notmatch '^(?i:true)$' -or
        [string]$pngRow.opaque_white_rectangle_detected -notmatch
            '^(?i:false)$' -or
        [string]$pngRow.no_opaque_artboard_background -notmatch
            '^(?i:true)$' -or
        [string]$pngRow.output_hash_match -notmatch '^(?i:true)$') {
        Add-AcceptanceError -Errors $errors -Message (
            "PNG acceptance identity/criteria mismatch: index $($pngRow.index)."
        )
    }
}

$contactUnique = @($contactRows | Group-Object index)
if ($contactRows.Count -ne 25 -or
    $contactUnique.Count -ne 25 -or
    @($contactUnique | Where-Object Count -ne 1).Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Contact manifest должен содержать 25 уникальных пар."
    )
}
foreach ($contactRow in $contactRows) {
    $manifestRow = $manifestRows |
        Where-Object { [int]$_.index -eq [int]$contactRow.index } |
        Select-Object -First 1
    if (-not $manifestRow -or
        $contactRow.corpus -ne $manifestRow.corpus -or
        [int]$contactRow.scale_percent -ne
            [int]$manifestRow.applied_scale_percent -or
        $contactRow.source_relpath -ne $manifestRow.source_relpath -or
        -not (Test-SamePath -Left $contactRow.reference_png `
            -Right $manifestRow.reference_png) -or
        -not (Test-SamePath -Left $contactRow.output_png `
            -Right $manifestRow.output_png)) {
        Add-AcceptanceError -Errors $errors -Message (
            "Contact manifest identity mismatch: index $($contactRow.index)."
        )
    }
}
foreach ($scale in @(110, 120, 150, 170, 200)) {
    if (@($contactRows | Where-Object {
        [int]$_.scale_percent -eq $scale
    }).Count -lt 3) {
        Add-AcceptanceError -Errors $errors -Message (
            "Contact manifest: для масштаба ${scale}% выбрано меньше трёх пар."
        )
    }
}
if (@($contactRows | Where-Object {
    [int]$_.scale_percent -eq 100
}).Count -ne 2) {
    Add-AcceptanceError -Errors $errors -Message (
        "Contact manifest не содержит ровно две планировки 100%."
    )
}
foreach ($corpus in $expectedCorpusCounts.Keys) {
    if (@($contactRows | Where-Object corpus -eq $corpus).Count -eq 0) {
        Add-AcceptanceError -Errors $errors -Message (
            "Contact manifest не покрывает $corpus."
        )
    }
}
foreach ($highRiskIndex in @(38, 68, 112, 164, 168, 223, 233, 254, 355, 384)) {
    if (-not ($contactRows | Where-Object {
        [int]$_.index -eq $highRiskIndex
    } | Select-Object -First 1)) {
        Add-AcceptanceError -Errors $errors -Message (
            "Contact manifest не содержит high-risk index $highRiskIndex."
        )
    }
}

$contactSheetFiles = @()
if (Test-Path -LiteralPath $contactRoot -PathType Container) {
    $contactSheetFiles = @(
        Get-ChildItem -LiteralPath $contactRoot -File `
            -Filter 'contact_sheet_*.png'
    )
}
$expectedContactSheets = 7
if ($contactSheetFiles.Count -ne $expectedContactSheets -or
    @($contactSheetFiles | Where-Object Length -le 0).Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Ожидалось $expectedContactSheets непустых контактных листов."
    )
}
$overviewPath = Join-Path $contactRoot 'all_388_outputs_overview.png'
if (-not (Test-Path -LiteralPath $overviewPath -PathType Leaf) -or
    (Test-Path -LiteralPath $overviewPath -PathType Leaf) -and
        (Get-Item -LiteralPath $overviewPath).Length -le 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Не найден непустой обзор всех 388 PNG."
    )
}

if (-not $visualReview -or
    $visualReview.run_id -ne $RunId -or
    $visualReview.status -ne 'accepted' -or
    [int]$visualReview.required_pairs -ne 25 -or
    [int]$visualReview.selected_pairs -ne 25 -or
    [int]$visualReview.reviewed_pairs -ne 25 -or
    [int]$visualReview.contact_sheets -ne $expectedContactSheets -or
    @($visualReview.findings).Count -ne 0) {
    Add-AcceptanceError -Errors $errors -Message (
        "Визуальная проверка контактных листов не принята."
    )
}

$accepted = $errors.Count -eq 0
$acceptance = [ordered]@{
    schema_version = 1
    run_id = $RunId
    timestamp = (Get-Date).ToString('s')
    accepted = $accepted
    manifest_rows = $manifestRows.Count
    checked_ok_rows = $checkedRows
    output_ai = $outputAiFiles.Count
    output_png = $outputPngFiles.Count
    process_report_rows = $processRows.Count
    latest_process_rows = $latestProcessRows.Count
    latest_verify_rows = $latestVerifyRows.Count
    processing_completed = if ($processingProgress) {
        $processingProgress.status -eq 'completed'
    } else {
        $false
    }
    same_illustrator_session = if ($preflightSummary -and $processingProgress) {
        [int]$preflightSummary.same_session_pid -eq
            [int]$processingProgress.illustrator_pid
    } else {
        $false
    }
    legacy_geometry_remediated = if ($legacyGeometry) {
        $legacyGeometry.status -eq 'completed' -and
            [int]$legacyGeometry.completed -eq 7
    } else {
        $false
    }
    enhanced_reverify_accepted = if ($enhancedReverify) {
        $enhancedReverify.status -eq 'completed' -and
            [int]$enhancedReverify.ok -eq 388
    } else {
        $false
    }
    preflight_accepted = if ($preflightSummary) {
        Test-StrictTrue $preflightSummary.accepted_distribution
    } else {
        $false
    }
    visual_review_accepted = if ($visualReview) {
        $visualReview.status -eq 'accepted'
    } else {
        $false
    }
    png_acceptance_accepted = if ($pngAcceptance) {
        Test-StrictTrue $pngAcceptance.accepted
    } else {
        $false
    }
    contact_pairs = $contactRows.Count
    contact_sheets = $contactSheetFiles.Count
    errors = $errors.ToArray()
    manifest = $manifestPath
    process_report = $processReportPath
    verify_report = $verifyReportPath
    preflight_summary = $preflightSummaryPath
    processing_progress = $processingProgressPath
    legacy_geometry_reprocess = $legacyGeometryPath
    enhanced_reverify = $enhancedReverifyPath
    png_acceptance = $pngAcceptancePath
    png_acceptance_report = $pngAcceptanceReportPath
    visual_review = $visualReviewPath
    contact_manifest = $contactManifestPath
    output_root = $outputRoot
}
Write-Utf8Text -Path $acceptancePath -Text (
    $acceptance | ConvertTo-Json -Depth 8
)

if (Test-Path -LiteralPath $summaryPath -PathType Leaf) {
    $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
    $summary.stage = if ($accepted) { 'accepted' } else { 'acceptance_failed' }
    $summary | Add-Member -NotePropertyName final_acceptance `
        -NotePropertyValue $acceptance -Force
    Write-Utf8Text -Path $summaryPath -Text ($summary | ConvertTo-Json -Depth 14)
}

[pscustomobject]@{
    RunId = $RunId
    Accepted = $accepted
    Errors = $errors.Count
    ManifestRows = $manifestRows.Count
    OutputAi = $outputAiFiles.Count
    OutputPng = $outputPngFiles.Count
    VerifyRows = $latestVerifyRows.Count
    AcceptanceReport = $acceptancePath
}

if (-not $accepted) {
    exit 2
}
