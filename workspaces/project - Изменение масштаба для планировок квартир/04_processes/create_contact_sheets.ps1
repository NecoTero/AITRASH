[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RunId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Write-Utf8Text {
    param([string]$Path, [string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Write-Utf8Csv {
    param([string]$Path, [object[]]$Rows)
    $lines = @($Rows | ConvertTo-Csv -NoTypeInformation)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllLines($Path, $lines, $encoding)
}

function Draw-Checkerboard {
    param(
        [System.Drawing.Graphics]$Graphics,
        [System.Drawing.Rectangle]$Rectangle,
        [int]$Cell = 20
    )
    $light = [Drawing.SolidBrush]::new(
        [Drawing.Color]::FromArgb(245, 245, 245)
    )
    $dark = [Drawing.SolidBrush]::new(
        [Drawing.Color]::FromArgb(220, 220, 220)
    )
    try {
        for ($y = $Rectangle.Top; $y -lt $Rectangle.Bottom; $y += $Cell) {
            for ($x = $Rectangle.Left; $x -lt $Rectangle.Right; $x += $Cell) {
                $brush = if (
                    (([int](($x - $Rectangle.Left) / $Cell) +
                      [int](($y - $Rectangle.Top) / $Cell)) % 2) -eq 0
                ) {
                    $light
                } else {
                    $dark
                }
                $width = [Math]::Min($Cell, $Rectangle.Right - $x)
                $height = [Math]::Min($Cell, $Rectangle.Bottom - $y)
                $Graphics.FillRectangle($brush, $x, $y, $width, $height)
            }
        }
    } finally {
        $light.Dispose()
        $dark.Dispose()
    }
}

function Draw-ImageFit {
    param(
        [System.Drawing.Graphics]$Graphics,
        [string]$Path,
        [System.Drawing.Rectangle]$Rectangle
    )
    $source = [Drawing.Image]::FromFile($Path)
    try {
        $scale = [Math]::Min(
            $Rectangle.Width / [double]$source.Width,
            $Rectangle.Height / [double]$source.Height
        )
        $width = [int][Math]::Round($source.Width * $scale)
        $height = [int][Math]::Round($source.Height * $scale)
        $x = $Rectangle.X + [int](($Rectangle.Width - $width) / 2)
        $y = $Rectangle.Y + [int](($Rectangle.Height - $height) / 2)
        $Graphics.DrawImage(
            $source,
            ([Drawing.Rectangle]::new($x, $y, $width, $height))
        )
    } finally {
        $source.Dispose()
    }
}

function Select-MiddleRow {
    param([object[]]$Rows)
    if ($Rows.Count -eq 0) {
        return $null
    }
    $sorted = @($Rows | Sort-Object { [int]$_.index })
    return $sorted[[int][Math]::Floor(($sorted.Count - 1) / 2)]
}

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$diagnosticsRoot = Join-Path $workspace "09_outputs\_diagnostics\full_$RunId"
$manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
$contactRoot = Join-Path $diagnosticsRoot 'contact_sheets'
$contactManifestPath = Join-Path $contactRoot 'contact_sheet_manifest.csv'
$stagingRoot = Join-Path $diagnosticsRoot (
    'contact_sheets_staging_{0}_{1}' -f (
        Get-Date -Format 'yyyyMMdd_HHmmss_fff'
    ), $PID
)
$stagingManifestPath = Join-Path $stagingRoot 'contact_sheet_manifest.csv'
$visualReviewPath = Join-Path $diagnosticsRoot 'visual_review.json'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Не найден manifest: $manifestPath"
}
if ((Test-Path -LiteralPath $contactRoot -PathType Container) -and
    @(Get-ChildItem -LiteralPath $contactRoot -Force).Count -ne 0) {
    throw "Каталог contact_sheets должен быть пуст перед созданием."
}
[IO.Directory]::CreateDirectory($stagingRoot) | Out-Null

$manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
if ($manifestRows.Count -ne 388 -or
    @($manifestRows | Where-Object status -ne 'OK').Count -ne 0) {
    throw "Контактные листы создаются только после состояния 388 OK."
}

$selectedCandidates = New-Object System.Collections.Generic.List[object]
$coverageIndices = New-Object System.Collections.Generic.List[int]
foreach ($row in @(
    $manifestRows |
        Where-Object { [int]$_.applied_scale_percent -eq 100 } |
        Sort-Object { [int]$_.index }
)) {
    $selectedCandidates.Add($row)
    $coverageIndices.Add([int]$row.index)
}
foreach ($scale in @(110, 120, 150, 170, 200)) {
    foreach ($corpus in @('Корпус 2.1', 'Корпус 2.2', 'Корпус 2.3')) {
        $candidate = Select-MiddleRow -Rows @(
            $manifestRows |
                Where-Object {
                    [int]$_.applied_scale_percent -eq $scale -and
                    $_.corpus -eq $corpus
                }
        )
        if (-not $candidate) {
            throw "Нет кандидата для контактного листа: $corpus ${scale}%."
        }
        $selectedCandidates.Add($candidate)
        $coverageIndices.Add([int]$candidate.index)
    }
}
if ($selectedCandidates.Count -ne 17) {
    throw "Ожидалось базово выбрать 17 пар, выбрано $($selectedCandidates.Count)."
}

$highRiskTags = @{
    38 = 'компактная близкая к квадратной'
    68 = 'вертикальная с балконами'
    112 = 'регрессия сохранения пустого слоя'
    164 = 'почти квадратная с выступающими дверью и маркой'
    168 = 'горизонтальная с выносной маркой'
    223 = 'аномальный PNG-эталон 14315x1417'
    233 = '100%; вертикальная; сложный контур; крупная терраса'
    254 = 'регрессия сохранения пустого слоя'
    355 = 'вертикальная'
    384 = '100%; горизонтальная; сложный контур; террасы'
}
foreach ($index in @($highRiskTags.Keys | Sort-Object)) {
    $candidate = $manifestRows |
        Where-Object { [int]$_.index -eq [int]$index } |
        Select-Object -First 1
    if (-not $candidate) {
        throw "Нет обязательного high-risk кандидата index ${index}."
    }
    $selectedCandidates.Add($candidate)
}

$selected = @(
    $selectedCandidates |
        Sort-Object { [int]$_.index } -Unique
)
if ($selected.Count -ne 25) {
    throw "Ожидалось выбрать 25 уникальных пар, выбрано $($selected.Count)."
}

$contactRows = New-Object System.Collections.Generic.List[object]
$pairsPerSheet = 4
$sheetCount = [int][Math]::Ceiling($selected.Count / [double]$pairsPerSheet)
$titleFont = [Drawing.Font]::new('Arial', 15, [Drawing.FontStyle]::Bold)
$labelFont = [Drawing.Font]::new('Arial', 11, [Drawing.FontStyle]::Regular)
$smallFont = [Drawing.Font]::new('Arial', 9, [Drawing.FontStyle]::Regular)
$textBrush = [Drawing.SolidBrush]::new(
    [Drawing.Color]::FromArgb(25, 25, 25)
)
$panelPen = [Drawing.Pen]::new(
    [Drawing.Color]::FromArgb(120, 120, 120),
    1
)

try {
    for ($sheetIndex = 0; $sheetIndex -lt $sheetCount; $sheetIndex += 1) {
        $bitmap = [Drawing.Bitmap]::new(1640, 930)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.InterpolationMode =
                [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.Clear([Drawing.Color]::White)
            $graphics.DrawString(
                "МКД2 — эталон слева / результат справа — лист $($sheetIndex + 1)/$sheetCount",
                $titleFont,
                $textBrush,
                20,
                12
            )
            for ($slot = 0; $slot -lt $pairsPerSheet; $slot += 1) {
                $selectedIndex = $sheetIndex * $pairsPerSheet + $slot
                if ($selectedIndex -ge $selected.Count) {
                    break
                }
                $row = $selected[$selectedIndex]
                $column = $slot % 2
                $line = [int][Math]::Floor($slot / 2)
                $cellX = 20 + $column * 810
                $cellY = 55 + $line * 430
                $referenceRect = [Drawing.Rectangle]::new(
                    $cellX,
                    $cellY + 48,
                    380,
                    350
                )
                $outputRect = [Drawing.Rectangle]::new(
                    $cellX + 400,
                    $cellY + 48,
                    380,
                    350
                )
                Draw-Checkerboard -Graphics $graphics -Rectangle $referenceRect
                Draw-Checkerboard -Graphics $graphics -Rectangle $outputRect
                Draw-ImageFit -Graphics $graphics -Path $row.reference_png `
                    -Rectangle $referenceRect
                Draw-ImageFit -Graphics $graphics -Path $row.output_png `
                    -Rectangle $outputRect
                $graphics.DrawRectangle($panelPen, $referenceRect)
                $graphics.DrawRectangle($panelPen, $outputRect)
                $graphics.DrawString(
                    "$($row.corpus) | $($row.applied_scale_percent)% | index $($row.index)",
                    $labelFont,
                    $textBrush,
                    $cellX,
                    $cellY
                )
                $graphics.DrawString(
                    $row.source_relpath,
                    $smallFont,
                    $textBrush,
                    $cellX,
                    $cellY + 23
                )
                $graphics.DrawString('ЭТАЛОН', $smallFont, $textBrush, $cellX, $cellY + 405)
                $graphics.DrawString('РЕЗУЛЬТАТ', $smallFont, $textBrush, $cellX + 400, $cellY + 405)
                $selectionReasons = New-Object System.Collections.Generic.List[string]
                if ($coverageIndices.Contains([int]$row.index)) {
                    if ([int]$row.applied_scale_percent -eq 100) {
                        $selectionReasons.Add('обе обязательные планировки 100%')
                    } else {
                        $selectionReasons.Add('покрытие каждого корпуса и масштаба')
                    }
                }
                if ($highRiskTags.ContainsKey([int]$row.index)) {
                    $selectionReasons.Add([string]$highRiskTags[[int]$row.index])
                }
                $contactRows.Add([pscustomobject][ordered]@{
                    sheet = $sheetIndex + 1
                    slot = $slot + 1
                    index = $row.index
                    corpus = $row.corpus
                    scale_percent = $row.applied_scale_percent
                    source_relpath = $row.source_relpath
                    reference_png = $row.reference_png
                    output_png = $row.output_png
                    selection_reasons = $selectionReasons -join '; '
                })
            }
            $sheetPath = Join-Path $stagingRoot (
                'contact_sheet_{0:D2}.png' -f ($sheetIndex + 1)
            )
            $bitmap.Save($sheetPath, [Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }

    $overviewColumns = 20
    $overviewCell = 100
    $overviewRows = [int][Math]::Ceiling(388 / [double]$overviewColumns)
    $overview = [Drawing.Bitmap]::new(
        $overviewColumns * $overviewCell,
        $overviewRows * $overviewCell
    )
    $overviewGraphics = [Drawing.Graphics]::FromImage($overview)
    try {
        $overviewGraphics.Clear([Drawing.Color]::FromArgb(225, 225, 225))
        $sortedRows = @($manifestRows | Sort-Object { [int]$_.index })
        for ($i = 0; $i -lt $sortedRows.Count; $i += 1) {
            $rect = [Drawing.Rectangle]::new(
                ($i % $overviewColumns) * $overviewCell,
                [int][Math]::Floor($i / $overviewColumns) * $overviewCell,
                $overviewCell,
                $overviewCell
            )
            Draw-ImageFit -Graphics $overviewGraphics `
                -Path $sortedRows[$i].output_png -Rectangle $rect
        }
        $overviewPath = Join-Path $stagingRoot 'all_388_outputs_overview.png'
        $overview.Save($overviewPath, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $overviewGraphics.Dispose()
        $overview.Dispose()
    }
} finally {
    $titleFont.Dispose()
    $labelFont.Dispose()
    $smallFont.Dispose()
    $textBrush.Dispose()
    $panelPen.Dispose()
}

Write-Utf8Csv -Path $stagingManifestPath -Rows $contactRows.ToArray()
if (Test-Path -LiteralPath $contactRoot -PathType Container) {
    if (@(Get-ChildItem -LiteralPath $contactRoot -Force).Count -ne 0) {
        throw "Каталог contact_sheets стал непустым во время staging."
    }
    [System.IO.Directory]::Delete($contactRoot, $false)
}
[System.IO.Directory]::Move($stagingRoot, $contactRoot)
$draft = [ordered]@{
    schema_version = 1
    run_id = $RunId
    status = 'pending'
    created_at = (Get-Date).ToString('s')
    reviewed_at = ''
    reviewed_pairs = 0
    selected_pairs = $selected.Count
    contact_sheets = $sheetCount
    required_pairs = 25
    includes_all_100_percent = $true
    scale_corpus_coverage_pairs = 17
    high_risk_indices = @($highRiskTags.Keys | Sort-Object)
    overview = 'contact_sheets/all_388_outputs_overview.png'
    criteria = @(
        'нет пропавших элементов',
        'нет обрезки',
        'нет неравномерного масштаба',
        'центрирование корректно',
        'пропорции сохранены',
        'прозрачный фон'
    )
    findings = @()
}
Write-Utf8Text -Path $visualReviewPath -Text ($draft | ConvertTo-Json -Depth 6)

[pscustomobject]@{
    RunId = $RunId
    SelectedPairs = $selected.Count
    ContactSheets = $sheetCount
    ContactRoot = $contactRoot
    ContactManifest = $contactManifestPath
    VisualReview = $visualReviewPath
}
