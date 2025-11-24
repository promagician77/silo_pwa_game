# PowerShell script to normalize line endings in archive files
# This prevents file size mismatches when deploying to Netlify
# Netlify converts CRLF to LF, causing size verification failures

Write-Host "Normalizing line endings in archive files..." -ForegroundColor Cyan

$archiveDir = Join-Path $PSScriptRoot "archive"
if (-not (Test-Path $archiveDir)) {
    Write-Host "Error: archive directory not found!" -ForegroundColor Red
    exit 1
}

# Text files that might have line ending issues
$textFiles = @(
    "game0.projectc",
    "game0.dmanifest",
    "archive_files.json"
)

$totalSaved = 0
foreach ($file in $textFiles) {
    $filePath = Join-Path $archiveDir $file
    if (Test-Path $filePath) {
        $originalSize = (Get-Item $filePath).Length
        $content = Get-Content $filePath -Raw
        $lfContent = $content -replace "`r`n", "`n"
        [System.IO.File]::WriteAllText($filePath, $lfContent, [System.Text.UTF8Encoding]::new($false))
        $newSize = (Get-Item $filePath).Length
        $saved = $originalSize - $newSize
        if ($saved -gt 0) {
            Write-Host "  $file : $originalSize -> $newSize bytes (saved $saved bytes)" -ForegroundColor Green
            $totalSaved += $saved
        } else {
            Write-Host "  $file : Already normalized" -ForegroundColor Gray
        }
    }
}

if ($totalSaved -gt 0) {
    Write-Host "`nTotal bytes saved: $totalSaved" -ForegroundColor Yellow
    Write-Host "`nWARNING: You need to update archive_files.json with the new file sizes!" -ForegroundColor Yellow
    Write-Host "Current game0.projectc size: $((Get-Item (Join-Path $archiveDir 'game0.projectc')).Length) bytes" -ForegroundColor Yellow
} else {
    Write-Host "`nAll files already normalized." -ForegroundColor Green
}

Write-Host "`nDone!" -ForegroundColor Cyan

