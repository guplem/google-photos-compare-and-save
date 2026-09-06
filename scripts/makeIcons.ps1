# Draws the extension icons.
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts/makeIcons.ps1
# The artwork matches the "not saved" badge: an arrow dropping into a tray.

Add-Type -AssemblyName System.Drawing

$source = 512
$bitmap = New-Object System.Drawing.Bitmap($source, $source)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

# Dark rounded square background.
$radius = [int]($source * 0.22)
$background = New-Object System.Drawing.Drawing2D.GraphicsPath
$background.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
$background.AddArc($source - $radius * 2, 0, $radius * 2, $radius * 2, 270, 90)
$background.AddArc($source - $radius * 2, $source - $radius * 2, $radius * 2, $radius * 2, 0, 90)
$background.AddArc(0, $source - $radius * 2, $radius * 2, $radius * 2, 90, 90)
$background.CloseFigure()
$backgroundBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 32, 33, 36))
$graphics.FillPath($backgroundBrush, $background)

# Amber arrow dropping into a tray.
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 179, 0)), 46
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$graphics.DrawLine($pen, 256, 96, 256, 288)
$graphics.DrawLines($pen, @(
  (New-Object System.Drawing.Point(180, 216)),
  (New-Object System.Drawing.Point(256, 292)),
  (New-Object System.Drawing.Point(332, 216))
))
$graphics.DrawLines($pen, @(
  (New-Object System.Drawing.Point(120, 340)),
  (New-Object System.Drawing.Point(120, 404)),
  (New-Object System.Drawing.Point(392, 404)),
  (New-Object System.Drawing.Point(392, 340))
))

$outputDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

foreach ($size in 16, 32, 48, 128) {
  $scaled = New-Object System.Drawing.Bitmap($size, $size)
  $scaledGraphics = [System.Drawing.Graphics]::FromImage($scaled)
  $scaledGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scaledGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $scaledGraphics.DrawImage($bitmap, 0, 0, $size, $size)
  $scaled.Save((Join-Path $outputDirectory "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $scaledGraphics.Dispose()
  $scaled.Dispose()
  Write-Host "wrote icon$size.png"
}

$graphics.Dispose()
$bitmap.Dispose()
