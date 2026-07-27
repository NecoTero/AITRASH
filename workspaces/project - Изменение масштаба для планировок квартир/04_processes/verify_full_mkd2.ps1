[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RunId,

    [ValidateSet('Verify')]
    [string]$Stage = 'Verify',

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

    [System.IO.File]::WriteAllText(
        $Path,
        $Text,
        (New-Object System.Text.UTF8Encoding($true))
    )
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
    [System.IO.File]::WriteAllLines(
        $Path,
        @($Rows | ConvertTo-Csv -NoTypeInformation),
        (New-Object System.Text.UTF8Encoding($true))
    )
}

function Test-PdfCompatibleAi {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite
    )
    try {
        $length = [Math]::Min(4096, [int]$stream.Length)
        $buffer = New-Object byte[] $length
        [void]$stream.Read($buffer, 0, $length)
        $text = [System.Text.Encoding]::ASCII.GetString($buffer)
        return $text.Contains('%PDF-')
    } finally {
        $stream.Dispose()
    }
}

function Initialize-PngInspector {
    if ('Mkd2PngInspector' -as [type]) {
        return
    }

    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public sealed class Mkd2PngInspection
{
    public int Width { get; set; }
    public int Height { get; set; }
    public string PixelFormat { get; set; }
    public bool HasAlphaChannel { get; set; }
    public long TransparentPixels { get; set; }
    public long NonTransparentPixels { get; set; }
    public long SemiTransparentPixels { get; set; }
    public bool CornersTransparent { get; set; }
    public bool NonEmpty { get; set; }
    public bool HasVisibleNonWhitePixel { get; set; }
    public bool NoOpaqueWhiteRectangle { get; set; }
}

public static class Mkd2PngInspector
{
    public static Mkd2PngInspection Inspect(string path)
    {
        using (Bitmap source = new Bitmap(path))
        using (Bitmap bitmap = new Bitmap(
            source.Width,
            source.Height,
            PixelFormat.Format32bppArgb))
        {
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.Clear(Color.Transparent);
                graphics.DrawImageUnscaled(source, 0, 0);
            }

            Rectangle rectangle = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            BitmapData data = bitmap.LockBits(
                rectangle,
                ImageLockMode.ReadOnly,
                PixelFormat.Format32bppArgb);
            try
            {
                int stride = Math.Abs(data.Stride);
                byte[] bytes = new byte[stride * bitmap.Height];
                Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);

                long transparent = 0;
                long nonTransparent = 0;
                long semiTransparent = 0;
                bool visibleNonWhite = false;
                byte[] cornerAlpha = new byte[4];

                for (int y = 0; y < bitmap.Height; y++)
                {
                    int row = y * stride;
                    for (int x = 0; x < bitmap.Width; x++)
                    {
                        int offset = row + x * 4;
                        byte blue = bytes[offset];
                        byte green = bytes[offset + 1];
                        byte red = bytes[offset + 2];
                        byte alpha = bytes[offset + 3];

                        if (alpha == 0)
                        {
                            transparent++;
                        }
                        else
                        {
                            nonTransparent++;
                            if (alpha < 255)
                            {
                                semiTransparent++;
                            }
                            if (red < 250 || green < 250 || blue < 250)
                            {
                                visibleNonWhite = true;
                            }
                        }
                    }
                }

                cornerAlpha[0] = bytes[3];
                cornerAlpha[1] = bytes[(bitmap.Width - 1) * 4 + 3];
                cornerAlpha[2] = bytes[(bitmap.Height - 1) * stride + 3];
                cornerAlpha[3] = bytes[
                    (bitmap.Height - 1) * stride +
                    (bitmap.Width - 1) * 4 +
                    3];
                bool cornersTransparent =
                    cornerAlpha[0] == 0 &&
                    cornerAlpha[1] == 0 &&
                    cornerAlpha[2] == 0 &&
                    cornerAlpha[3] == 0;

                return new Mkd2PngInspection
                {
                    Width = source.Width,
                    Height = source.Height,
                    PixelFormat = source.PixelFormat.ToString(),
                    HasAlphaChannel = Image.IsAlphaPixelFormat(source.PixelFormat),
                    TransparentPixels = transparent,
                    NonTransparentPixels = nonTransparent,
                    SemiTransparentPixels = semiTransparent,
                    CornersTransparent = cornersTransparent,
                    NonEmpty = nonTransparent > 0,
                    HasVisibleNonWhitePixel = visibleNonWhite,
                    NoOpaqueWhiteRectangle =
                        cornersTransparent &&
                        transparent > 0 &&
                        visibleNonWhite
                };
            }
            finally
            {
                bitmap.UnlockBits(data);
            }
        }
    }
}
'@
}

function Update-AggregateVerifyReport {
    param(
        [Parameter(Mandatory = $true)]
        [string]$VerifyBatchRoot,

        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    $allRows = New-Object System.Collections.Generic.List[object]
    $combinedFiles = @(
        Get-ChildItem -LiteralPath $VerifyBatchRoot -File -Filter 'verify_*_combined.csv' |
            Sort-Object Name
    )
    foreach ($combinedFile in $combinedFiles) {
        foreach ($row in @(Import-Csv -LiteralPath $combinedFile.FullName -Encoding UTF8)) {
            $allRows.Add($row)
        }
    }
    if ($allRows.Count -gt 0) {
        Write-Utf8Csv -Path $OutputPath -Rows $allRows.ToArray()
    }
}

function Update-VerifySummary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SummaryPath,

        [Parameter(Mandatory = $true)]
        [object[]]$ManifestRows,

        [Parameter(Mandatory = $true)]
        [string]$LastBatch
    )

    $summary = Get-Content -LiteralPath $SummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $summary.stage = 'verifying'
    $summary.pending = @($ManifestRows | Where-Object status -eq 'PENDING').Count
    $summary.ok = @($ManifestRows | Where-Object status -eq 'OK').Count
    $summary.error = @(
        $ManifestRows |
            Where-Object {
                $_.status -eq 'ERROR' -or
                $_.status -eq 'VERIFY_ERROR' -or
                $_.status -eq 'SOURCE_HASH_MISMATCH'
            }
    ).Count
    $summary.verified = @($ManifestRows | Where-Object status -eq 'OK').Count
    $summary | Add-Member -NotePropertyName processed_ok -NotePropertyValue (
        @($ManifestRows | Where-Object status -eq 'PROCESSED_OK').Count
    ) -Force
    $summary | Add-Member -NotePropertyName last_verify_batch -NotePropertyValue $LastBatch -Force
    $summary | Add-Member -NotePropertyName updated_at -NotePropertyValue (
        (Get-Date).ToString('s')
    ) -Force
    Write-Utf8Text -Path $SummaryPath -Text ($summary | ConvertTo-Json -Depth 10)
}

function Invoke-VerifyBatch {
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

    Initialize-PngInspector

    $diagnosticsRoot = Join-Path $Workspace "09_outputs\_diagnostics\full_$RunIdValue"
    $manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
    $summaryPath = Join-Path $diagnosticsRoot 'summary.json'
    $verifyDetailsRoot = Join-Path $diagnosticsRoot 'verify_details'
    $verifyBatchRoot = Join-Path $diagnosticsRoot 'verify_batches'
    $verifyReportPath = Join-Path $diagnosticsRoot 'verify_report.csv'
    $scriptPath = Join-Path $PSScriptRoot 'presale_site_verify.jsx'
    $activeJobPath = Join-Path $PSScriptRoot 'presale_site_verify_job.json'

    foreach ($required in @($manifestPath, $summaryPath, $scriptPath)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Не найден обязательный файл: $required"
        }
    }
    foreach ($directory in @($verifyDetailsRoot, $verifyBatchRoot)) {
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
                ($_.status -eq 'PROCESSED_OK' -or $_.status -eq 'VERIFY_ERROR')
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
            Message = 'Нет записей PROCESSED_OK/VERIFY_ERROR в заданном диапазоне.'
        }
    }

    $batchId = '{0:D3}_{1:D3}_{2}' -f (
        [int]$eligible[0].index
    ), (
        [int]$eligible[-1].index
    ), (
        Get-Date -Format 'yyyyMMdd_HHmmss'
    )
    $illustratorReportPath = Join-Path $verifyBatchRoot "verify_${batchId}_illustrator.csv"
    $combinedReportPath = Join-Path $verifyBatchRoot "verify_${batchId}_combined.csv"
    $jobArchivePath = Join-Path $verifyBatchRoot "verify_${batchId}_job.json"
    $manifestSnapshotPath = Join-Path $verifyBatchRoot "manifest_after_verify_${batchId}.csv"

    $jobEntries = New-Object System.Collections.Generic.List[object]
    foreach ($manifestRow in $eligible) {
        foreach ($outputPath in @($manifestRow.output_ai, $manifestRow.output_png)) {
            if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf) -or
                (Get-Item -LiteralPath $outputPath).Length -le 0) {
                throw "Не найден результат для проверки: $outputPath"
            }
        }
        $sourceHash = (
            Get-FileHash -LiteralPath $manifestRow.source_ai -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($sourceHash -ne $manifestRow.source_sha256_before) {
            throw "SHA-256 исходника изменился до verify: $($manifestRow.source_relpath)"
        }
        $aiHash = (
            Get-FileHash -LiteralPath $manifestRow.output_ai -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        $pngHash = (
            Get-FileHash -LiteralPath $manifestRow.output_png -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($aiHash -ne $manifestRow.output_ai_sha256 -or
            $pngHash -ne $manifestRow.output_png_sha256) {
            throw "SHA-256 результата изменился до verify: $($manifestRow.source_relpath)"
        }

        $sourceStem = [System.IO.Path]::GetFileNameWithoutExtension(
            [string]$manifestRow.source_ai
        )
        $verifyAuditPath = Join-Path $verifyDetailsRoot (
            '{0:D3}_{1}_verify.json' -f [int]$manifestRow.index, $sourceStem
        )
        if (Test-Path -LiteralPath $verifyAuditPath) {
            throw "Verify audit уже существует: $verifyAuditPath"
        }

        $jobEntries.Add([pscustomobject][ordered]@{
            index = [int]$manifestRow.index
            source_relpath = [string]$manifestRow.source_relpath
            source_ai = [string]$manifestRow.source_ai
            output_ai = [string]$manifestRow.output_ai
            output_png = [string]$manifestRow.output_png
            expected_scale_percent = [int]$manifestRow.applied_scale_percent
            verify_audit = $verifyAuditPath
        })
    }

    $job = [ordered]@{
        schema_version = 1
        run_id = $RunIdValue
        batch_id = $batchId
        created_at = (Get-Date).ToString('s')
        batch_report = $illustratorReportPath
        artboard_size_pt = 1200
        bounds_tolerance_pt = 0.02
        stroke_width_pt = 0.75
        stroke_tolerance_pt = 0.0001
        output_prefix = 'х'
        entries = $jobEntries.ToArray()
    }
    $jobText = $job | ConvertTo-Json -Depth 8
    Write-Utf8Text -Path $jobArchivePath -Text $jobText
    Write-Utf8Text -Path $activeJobPath -Text $jobText

    $illustratorError = $null
    try {
        $illustrator = New-Object -ComObject Illustrator.Application
        [void]$illustrator.DoJavaScriptFile($scriptPath)
    } catch {
        $illustratorError = $_
    }

    if (-not (Test-Path -LiteralPath $illustratorReportPath)) {
        if ($illustratorError) {
            throw "Illustrator не создал verify report: $($illustratorError.Exception.Message)"
        }
        throw "Illustrator не создал verify report."
    }

    $illustratorRows = @(
        Import-Csv -LiteralPath $illustratorReportPath -Encoding UTF8
    )
    $combinedRows = New-Object System.Collections.Generic.List[object]
    foreach ($illustratorRow in $illustratorRows) {
        $manifestRow = $manifestRows | Where-Object {
            [int]$_.index -eq [int]$illustratorRow.index
        } | Select-Object -First 1
        if (-not $manifestRow) {
            throw "Verify report содержит неизвестный индекс: $($illustratorRow.index)"
        }

        $errors = New-Object System.Collections.Generic.List[string]
        if ($illustratorRow.status -ne 'OK') {
            $errors.Add("Illustrator: $($illustratorRow.comment)")
        }

        $pngInspection = $null
        try {
            $pngInspection = [Mkd2PngInspector]::Inspect($manifestRow.output_png)
            if ($pngInspection.Width -ne 1200 -or $pngInspection.Height -ne 1200) {
                $errors.Add('PNG имеет размер, отличный от 1200x1200.')
            }
            if (-not $pngInspection.HasAlphaChannel) {
                $errors.Add('PNG не имеет alpha-канала.')
            }
            if (-not $pngInspection.NonEmpty) {
                $errors.Add('PNG пуст.')
            }
            if (-not $pngInspection.CornersTransparent) {
                $errors.Add('Углы PNG не прозрачны.')
            }
            if (-not $pngInspection.NoOpaqueWhiteRectangle) {
                $errors.Add('PNG похож на изображение с непрозрачным белым фоном.')
            }
        } catch {
            $errors.Add("PNG не декодируется: $($_.Exception.Message)")
        }

        $pdfCompatible = Test-PdfCompatibleAi -Path $manifestRow.output_ai
        if (-not $pdfCompatible) {
            $errors.Add('AI не содержит PDF-compatible заголовок.')
        }

        $sourceHashAfter = (
            Get-FileHash -LiteralPath $manifestRow.source_ai -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        $aiHashAfter = (
            Get-FileHash -LiteralPath $manifestRow.output_ai -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        $pngHashAfter = (
            Get-FileHash -LiteralPath $manifestRow.output_png -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        $sourceHashMatch = $sourceHashAfter -eq $manifestRow.source_sha256_before
        $aiHashMatch = $aiHashAfter -eq $manifestRow.output_ai_sha256
        $pngHashMatch = $pngHashAfter -eq $manifestRow.output_png_sha256
        if (-not $sourceHashMatch) {
            $errors.Add('SHA-256 исходного AI изменился.')
        }
        if (-not $aiHashMatch -or -not $pngHashMatch) {
            $errors.Add('SHA-256 выходной пары изменился.')
        }

        if ($errors.Count -eq 0) {
            $manifestRow.status = 'OK'
            $manifestRow.source_sha256_after = $sourceHashAfter
            $manifestRow.last_error = ''
        } else {
            $manifestRow.status = 'VERIFY_ERROR'
            $manifestRow.last_error = $errors -join ' | '
        }

        $combinedRows.Add([pscustomobject][ordered]@{
            batch_id = $batchId
            index = [int]$manifestRow.index
            status = if ($errors.Count -eq 0) { 'OK' } else { 'ERROR' }
            source_relpath = [string]$manifestRow.source_relpath
            applied_scale_percent = [int]$manifestRow.applied_scale_percent
            illustrator_status = [string]$illustratorRow.status
            ruler_units_pixels = [string]$illustratorRow.ruler_units_pixels
            artboards = [string]$illustratorRow.artboards
            artboard_width = [string]$illustratorRow.artboard_width
            artboard_height = [string]$illustratorRow.artboard_height
            center_x = [string]$illustratorRow.center_x
            center_y = [string]$illustratorRow.center_y
            inside_artboard = [string]$illustratorRow.inside_artboard
            stroke_count = [string]$illustratorRow.stroke_count
            stroke_mismatch_count = [string]$illustratorRow.stroke_mismatch_count
            source_item_count = [string]$illustratorRow.source_item_count
            output_item_count = [string]$illustratorRow.output_item_count
            source_layer_count = [string]$illustratorRow.source_layer_count
            output_layer_count = [string]$illustratorRow.output_layer_count
            layer_signature_match = [string]$illustratorRow.layer_signature_match
            item_structure_match = [string]$illustratorRow.item_structure_match
            item_state_match = [string]$illustratorRow.item_state_match
            color_space_match = [string]$illustratorRow.color_space_match
            names_match = [string]$illustratorRow.names_match
            pdf_compatible = [string]$pdfCompatible
            png_width = if ($pngInspection) { $pngInspection.Width } else { '' }
            png_height = if ($pngInspection) { $pngInspection.Height } else { '' }
            png_has_alpha = if ($pngInspection) { $pngInspection.HasAlphaChannel } else { '' }
            png_transparent_pixels = if ($pngInspection) { $pngInspection.TransparentPixels } else { '' }
            png_nontransparent_pixels = if ($pngInspection) { $pngInspection.NonTransparentPixels } else { '' }
            png_corners_transparent = if ($pngInspection) { $pngInspection.CornersTransparent } else { '' }
            png_no_opaque_white_rectangle = if ($pngInspection) {
                $pngInspection.NoOpaqueWhiteRectangle
            } else {
                ''
            }
            source_hash_match = [string]$sourceHashMatch
            output_ai_hash_match = [string]$aiHashMatch
            output_png_hash_match = [string]$pngHashMatch
            output_ai = [string]$manifestRow.output_ai
            output_png = [string]$manifestRow.output_png
            process_audit = [string]$manifestRow.audit_json
            verify_audit = [string]$illustratorRow.verify_audit
            comment = if ($errors.Count -eq 0) {
                'Независимая проверка AI/PNG/SHA-256 пройдена.'
            } else {
                $errors -join ' | '
            }
        })
    }

    Write-Utf8Csv -Path $combinedReportPath -Rows $combinedRows.ToArray()
    Write-Utf8Csv -Path $manifestPath -Rows $manifestRows
    Write-Utf8Csv -Path $manifestSnapshotPath -Rows $manifestRows
    Update-AggregateVerifyReport `
        -VerifyBatchRoot $verifyBatchRoot `
        -OutputPath $verifyReportPath
    Update-VerifySummary `
        -SummaryPath $summaryPath `
        -ManifestRows $manifestRows `
        -LastBatch $batchId

    if (@($manifestRows | Where-Object status -eq 'SOURCE_HASH_MISMATCH').Count -gt 0) {
        throw "Обнаружено изменение исходного SHA-256."
    }
    if ($illustratorError) {
        throw "Illustrator завершил verify с ошибкой: $($illustratorError.Exception.Message)"
    }

    [pscustomobject]@{
        RunId = $RunIdValue
        BatchId = $batchId
        Selected = $eligible.Count
        Ok = @($combinedRows | Where-Object status -eq 'OK').Count
        Errors = @($combinedRows | Where-Object status -eq 'ERROR').Count
        IllustratorReport = $illustratorReportPath
        CombinedReport = $combinedReportPath
        AggregateVerifyReport = $verifyReportPath
        Manifest = $manifestPath
        ManifestSnapshot = $manifestSnapshotPath
    }
}

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

switch ($Stage) {
    'Verify' {
        Invoke-VerifyBatch `
            -Workspace $workspace `
            -RunIdValue $RunId `
            -StartIndexValue $StartIndex `
            -MaxFilesValue $MaxFiles
    }
}
