# 生成 Windows 图标：build/icon.ico（应用）与 build/file.ico（.drawnix 文件关联）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

function New-LogoBitmap([int]$size, [bool]$withPage) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  $margin = [Math]::Max(1, [int]($size * 0.04))
  $w = $size - $margin * 2
  $radius = [int]($w * 0.24)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($margin, $margin, $radius * 2, $radius * 2, 180, 90)
  $path.AddArc($margin + $w - $radius * 2, $margin, $radius * 2, $radius * 2, 270, 90)
  $path.AddArc($margin + $w - $radius * 2, $margin + $w - $radius * 2, $radius * 2, $radius * 2, 0, 90)
  $path.AddArc($margin, $margin + $w - $radius * 2, $radius * 2, $radius * 2, 90, 90)
  $path.CloseFigure()

  $c1 = [System.Drawing.Color]::FromArgb(255, 79, 91, 255)
  $c2 = [System.Drawing.Color]::FromArgb(255, 138, 75, 255)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point($margin, $margin)),
    (New-Object System.Drawing.Point(($margin + $w), ($margin + $w))),
    $c1, $c2)
  $g.FillPath($brush, $path)

  $fontSize = [Math]::Max(7, [int]($w * 0.5))
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $g.DrawString('D', $font, $white, $rect, $sf)

  if ($withPage) {
    # 右下角画一个白色小页片，暗示"文件"
    $pageSize = [Math]::Max(4, [int]($w * 0.3))
    $px = $margin + $w - $pageSize - [Math]::Max(1, [int]($w * 0.06))
    $py = $margin + $w - $pageSize - [Math]::Max(1, [int]($w * 0.06))
    $g.FillRectangle($white, $px, $py, $pageSize, $pageSize)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 79, 91, 255), [Math]::Max(1, [int]($pageSize * 0.12)))
    for ($i = 1; $i -le 3; $i++) {
      $y = $py + [int]($pageSize * $i / 4)
      $g.DrawLine($pen, $px + [int]($pageSize * 0.2), $y, $px + [int]($pageSize * 0.8), $y)
    }
  }

  $g.Dispose()
  return $bmp
}

function Write-Ico([string]$filePath, [bool]$withPage) {
  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $images = @()
  foreach ($s in $sizes) {
    $bmp = New-LogoBitmap $s $withPage
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $images += ,@($s, $ms.ToArray())
    $ms.Dispose()
    $bmp.Dispose()
  }

  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($stream)
  $writer.Write([UInt16]0)          # reserved
  $writer.Write([UInt16]1)          # type: icon
  $writer.Write([UInt16]$images.Count)

  $offset = 6 + 16 * $images.Count
  foreach ($image in $images) {
    $size = [int]$image[0]
    $bytes = [byte[]]$image[1]
    $sizeByte = 0
    if ($size -lt 256) { $sizeByte = $size }
    $writer.Write([byte]$sizeByte)
    $writer.Write([byte]$sizeByte)
    $writer.Write([byte]0)          # color count
    $writer.Write([byte]0)          # reserved
    $writer.Write([UInt16]1)        # planes
    $writer.Write([UInt16]32)       # bit count
    $writer.Write([UInt32]$bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $bytes.Length
  }
  foreach ($image in $images) {
    $writer.Write([byte[]]$image[1])
  }
  $writer.Flush()
  [System.IO.File]::WriteAllBytes($filePath, $stream.ToArray())
  $writer.Dispose()
  $stream.Dispose()
  Write-Host "generated $filePath"
}

Write-Ico (Join-Path $buildDir 'icon.ico') $false
Write-Ico (Join-Path $buildDir 'file.ico') $true
