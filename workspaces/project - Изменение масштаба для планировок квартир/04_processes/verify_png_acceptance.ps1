[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RunId,

    [ValidateRange(1, 128)]
    [int]$EdgeFrameWidthPx = 16
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
    $lines = @($Rows | ConvertTo-Csv -NoTypeInformation)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllLines($Path, $lines, $encoding)
}

if (-not ('Mkd2FinalPngInspector' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public sealed class Mkd2FinalPngInspection
{
    public int Width { get; set; }
    public int Height { get; set; }
    public string PixelFormat { get; set; }
    public bool HasAlphaChannel { get; set; }
    public long TransparentPixels { get; set; }
    public long NonTransparentPixels { get; set; }
    public long SemiTransparentPixels { get; set; }
    public int EdgeFrameWidth { get; set; }
    public long EdgeFrameNonTransparentPixels { get; set; }
    public bool EdgeFrameTransparent { get; set; }
    public int ContentMinX { get; set; }
    public int ContentMinY { get; set; }
    public int ContentMaxX { get; set; }
    public int ContentMaxY { get; set; }
    public bool OpaqueWhiteBoundingRectangleDetected { get; set; }
    public bool NoOpaqueArtboardBackground { get; set; }
}

public static class Mkd2FinalPngInspector
{
    private static bool IsOpaqueNearWhite(
        byte blue,
        byte green,
        byte red,
        byte alpha)
    {
        return alpha >= 250 && red >= 248 && green >= 248 && blue >= 248;
    }

    public static Mkd2FinalPngInspection Inspect(string path, int edgeFrameWidth)
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
                long edgeFrameNonTransparent = 0;
                int minX = bitmap.Width;
                int minY = bitmap.Height;
                int maxX = -1;
                int maxY = -1;

                for (int y = 0; y < bitmap.Height; y++)
                {
                    int row = y * stride;
                    for (int x = 0; x < bitmap.Width; x++)
                    {
                        int offset = row + x * 4;
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
                            if (x < minX) minX = x;
                            if (x > maxX) maxX = x;
                            if (y < minY) minY = y;
                            if (y > maxY) maxY = y;

                            if (x < edgeFrameWidth ||
                                x >= bitmap.Width - edgeFrameWidth ||
                                y < edgeFrameWidth ||
                                y >= bitmap.Height - edgeFrameWidth)
                            {
                                edgeFrameNonTransparent++;
                            }
                        }
                    }
                }

                bool whiteRectangle = false;
                if (nonTransparent > 0 && maxX >= minX && maxY >= minY)
                {
                    int boundWidth = maxX - minX + 1;
                    int boundHeight = maxY - minY + 1;
                    long topWhite = 0;
                    long bottomWhite = 0;
                    long leftWhite = 0;
                    long rightWhite = 0;

                    for (int x = minX; x <= maxX; x++)
                    {
                        int topOffset = minY * stride + x * 4;
                        int bottomOffset = maxY * stride + x * 4;
                        if (IsOpaqueNearWhite(
                            bytes[topOffset],
                            bytes[topOffset + 1],
                            bytes[topOffset + 2],
                            bytes[topOffset + 3]))
                        {
                            topWhite++;
                        }
                        if (IsOpaqueNearWhite(
                            bytes[bottomOffset],
                            bytes[bottomOffset + 1],
                            bytes[bottomOffset + 2],
                            bytes[bottomOffset + 3]))
                        {
                            bottomWhite++;
                        }
                    }
                    for (int y = minY; y <= maxY; y++)
                    {
                        int leftOffset = y * stride + minX * 4;
                        int rightOffset = y * stride + maxX * 4;
                        if (IsOpaqueNearWhite(
                            bytes[leftOffset],
                            bytes[leftOffset + 1],
                            bytes[leftOffset + 2],
                            bytes[leftOffset + 3]))
                        {
                            leftWhite++;
                        }
                        if (IsOpaqueNearWhite(
                            bytes[rightOffset],
                            bytes[rightOffset + 1],
                            bytes[rightOffset + 2],
                            bytes[rightOffset + 3]))
                        {
                            rightWhite++;
                        }
                    }

                    whiteRectangle =
                        topWhite / (double)boundWidth >= 0.95 &&
                        bottomWhite / (double)boundWidth >= 0.95 &&
                        leftWhite / (double)boundHeight >= 0.95 &&
                        rightWhite / (double)boundHeight >= 0.95;
                }

                bool edgeFrameTransparent = edgeFrameNonTransparent == 0;
                return new Mkd2FinalPngInspection
                {
                    Width = source.Width,
                    Height = source.Height,
                    PixelFormat = source.PixelFormat.ToString(),
                    HasAlphaChannel = Image.IsAlphaPixelFormat(source.PixelFormat),
                    TransparentPixels = transparent,
                    NonTransparentPixels = nonTransparent,
                    SemiTransparentPixels = semiTransparent,
                    EdgeFrameWidth = edgeFrameWidth,
                    EdgeFrameNonTransparentPixels = edgeFrameNonTransparent,
                    EdgeFrameTransparent = edgeFrameTransparent,
                    ContentMinX = nonTransparent > 0 ? minX : -1,
                    ContentMinY = nonTransparent > 0 ? minY : -1,
                    ContentMaxX = maxX,
                    ContentMaxY = maxY,
                    OpaqueWhiteBoundingRectangleDetected = whiteRectangle,
                    NoOpaqueArtboardBackground =
                        edgeFrameTransparent &&
                        transparent > 0 &&
                        nonTransparent > 0 &&
                        !whiteRectangle
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

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$diagnosticsRoot = Join-Path $workspace "09_outputs\_diagnostics\full_$RunId"
$manifestPath = Join-Path $diagnosticsRoot 'manifest.csv'
$reportPath = Join-Path $diagnosticsRoot 'png_acceptance.csv'
$summaryPath = Join-Path $diagnosticsRoot 'png_acceptance.json'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Не найден manifest: $manifestPath"
}
$manifestRows = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
if ($manifestRows.Count -ne 388 -or
    @($manifestRows | Where-Object status -ne 'OK').Count -ne 0) {
    throw "PNG-приёмка запускается только после состояния 388 OK."
}

$rows = New-Object System.Collections.Generic.List[object]
foreach ($manifestRow in @($manifestRows | Sort-Object { [int]$_.index })) {
    $issues = New-Object System.Collections.Generic.List[string]
    $inspection = $null
    $hashMatch = $false
    try {
        if (-not (Test-Path -LiteralPath $manifestRow.output_png -PathType Leaf)) {
            throw "PNG отсутствует."
        }
        $inspection = [Mkd2FinalPngInspector]::Inspect(
            [string]$manifestRow.output_png,
            $EdgeFrameWidthPx
        )
        $actualHash = (
            Get-FileHash -LiteralPath $manifestRow.output_png -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        $hashMatch = $actualHash -eq $manifestRow.output_png_sha256

        if ($inspection.Width -ne 1200 -or $inspection.Height -ne 1200) {
            $issues.Add('размер не 1200x1200')
        }
        if (-not $inspection.HasAlphaChannel) {
            $issues.Add('нет alpha-канала')
        }
        if ($inspection.NonTransparentPixels -le 0) {
            $issues.Add('PNG пуст')
        }
        if ($inspection.TransparentPixels -le 0) {
            $issues.Add('нет прозрачных пикселей')
        }
        if (-not $inspection.EdgeFrameTransparent) {
            $issues.Add("непрозрачные пиксели в рамке ${EdgeFrameWidthPx}px")
        }
        if ($inspection.OpaqueWhiteBoundingRectangleDetected) {
            $issues.Add('обнаружена непрозрачная белая прямоугольная подложка')
        }
        if (-not $inspection.NoOpaqueArtboardBackground) {
            $issues.Add('не подтверждено отсутствие непрозрачного фона')
        }
        if (-not $hashMatch) {
            $issues.Add('SHA-256 PNG не совпал с manifest')
        }
    } catch {
        $issues.Add("ошибка декодирования/проверки: $($_.Exception.Message)")
    }

    $rows.Add([pscustomobject][ordered]@{
        index = [int]$manifestRow.index
        status = if ($issues.Count -eq 0) { 'OK' } else { 'ERROR' }
        source_relpath = [string]$manifestRow.source_relpath
        output_png = [string]$manifestRow.output_png
        width = if ($inspection) { $inspection.Width } else { '' }
        height = if ($inspection) { $inspection.Height } else { '' }
        pixel_format = if ($inspection) { $inspection.PixelFormat } else { '' }
        has_alpha_channel = if ($inspection) {
            $inspection.HasAlphaChannel
        } else {
            $false
        }
        transparent_pixels = if ($inspection) {
            $inspection.TransparentPixels
        } else {
            ''
        }
        nontransparent_pixels = if ($inspection) {
            $inspection.NonTransparentPixels
        } else {
            ''
        }
        semitransparent_pixels = if ($inspection) {
            $inspection.SemiTransparentPixels
        } else {
            ''
        }
        edge_frame_width_px = $EdgeFrameWidthPx
        edge_frame_nontransparent_pixels = if ($inspection) {
            $inspection.EdgeFrameNonTransparentPixels
        } else {
            ''
        }
        edge_frame_transparent = if ($inspection) {
            $inspection.EdgeFrameTransparent
        } else {
            $false
        }
        content_min_x = if ($inspection) { $inspection.ContentMinX } else { '' }
        content_min_y = if ($inspection) { $inspection.ContentMinY } else { '' }
        content_max_x = if ($inspection) { $inspection.ContentMaxX } else { '' }
        content_max_y = if ($inspection) { $inspection.ContentMaxY } else { '' }
        opaque_white_rectangle_detected = if ($inspection) {
            $inspection.OpaqueWhiteBoundingRectangleDetected
        } else {
            $false
        }
        no_opaque_artboard_background = if ($inspection) {
            $inspection.NoOpaqueArtboardBackground
        } else {
            $false
        }
        output_hash_match = $hashMatch
        comment = $issues -join '; '
    })
}

$allRows = $rows.ToArray()
$errorRows = @($allRows | Where-Object status -ne 'OK')
Write-Utf8Csv -Path $reportPath -Rows $allRows

$summary = [ordered]@{
    schema_version = 1
    run_id = $RunId
    timestamp = (Get-Date).ToString('s')
    accepted = $errorRows.Count -eq 0
    inspected = $allRows.Count
    errors = $errorRows.Count
    edge_frame_width_px = $EdgeFrameWidthPx
    all_size_1200 = @($allRows | Where-Object {
        [int]$_.width -ne 1200 -or [int]$_.height -ne 1200
    }).Count -eq 0
    all_alpha_channel = @($allRows | Where-Object {
        [string]$_.has_alpha_channel -notmatch '^(?i:true)$'
    }).Count -eq 0
    all_nonempty = @($allRows | Where-Object {
        [long]$_.nontransparent_pixels -le 0
    }).Count -eq 0
    all_edge_frames_transparent = @($allRows | Where-Object {
        [string]$_.edge_frame_transparent -notmatch '^(?i:true)$'
    }).Count -eq 0
    all_no_opaque_artboard_background = @($allRows | Where-Object {
        [string]$_.no_opaque_artboard_background -notmatch '^(?i:true)$'
    }).Count -eq 0
    all_output_hashes_match = @($allRows | Where-Object {
        [string]$_.output_hash_match -notmatch '^(?i:true)$'
    }).Count -eq 0
    report = $reportPath
}
Write-Utf8Text -Path $summaryPath -Text ($summary | ConvertTo-Json -Depth 6)

$summary
if ($errorRows.Count -ne 0) {
    exit 2
}
