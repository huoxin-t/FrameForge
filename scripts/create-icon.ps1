# 生成 FrameForge 的 Windows 应用图标。
# 不依赖第三方图形库：PowerShell + System.Drawing 生成 256x256 PNG，
# 再把 PNG 封装成 Vista+ 支持的 ICO 容器。
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $root 'build'
$pngPath = Join-Path $buildDirectory 'icon.png'
$icoPath = Join-Path $buildDirectory 'icon.ico'

New-Item -ItemType Directory -Force -Path $buildDirectory | Out-Null

$size = 256
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

function New-RoundedPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$backgroundPath = New-RoundedPath -X 12 -Y 12 -Width 232 -Height 232 -Radius 48
$backgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
  [System.Drawing.Color]::FromArgb(255, 28, 32, 42),
  [System.Drawing.Color]::FromArgb(255, 9, 11, 16),
  45
)
$graphics.FillPath($backgroundBrush, $backgroundPath)

$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 251, 191, 36), 5)
$graphics.DrawPath($borderPen, $backgroundPath)

$holeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 251, 191, 36))
for ($index = 0; $index -lt 5; $index++) {
  $y = 48 + ($index * 36)
  $left = New-RoundedPath -X 32 -Y $y -Width 16 -Height 22 -Radius 5
  $right = New-RoundedPath -X 208 -Y $y -Width 16 -Height 22 -Radius 5
  $graphics.FillPath($holeBrush, $left)
  $graphics.FillPath($holeBrush, $right)
  $left.Dispose()
  $right.Dispose()
}

$playBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 251, 191, 36))
$playPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$playPath.AddPolygon(@(
  (New-Object System.Drawing.PointF(102, 80)),
  (New-Object System.Drawing.PointF(102, 176)),
  (New-Object System.Drawing.PointF(180, 128))
))
$graphics.FillPath($playBrush, $playPath)

$highlightPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 255, 255, 255), 1.5)
$graphics.DrawArc($highlightPen, 20, 20, 216, 216, 205, 120)

$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Create($icoPath)
$writer = New-Object System.IO.BinaryWriter($stream)

# ICONDIR
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)

# ICONDIRENTRY：宽高为 0 表示 256x256，图像数据直接使用 PNG。
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)

$writer.Write($pngBytes)
$writer.Close()

$playPath.Dispose()
$playBrush.Dispose()
$highlightPen.Dispose()
$borderPen.Dispose()
$holeBrush.Dispose()
$backgroundBrush.Dispose()
$backgroundPath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Get-Item $pngPath, $icoPath | Select-Object FullName, Length
