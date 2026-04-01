#Requires -Version 5.1
<#
.SYNOPSIS
    Uninstalls Revit Active Quality Monitor from Revit 2026.
#>

$ErrorActionPreference = 'Stop'

$addinsRoot = Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2026'
$pluginDir  = Join-Path $addinsRoot 'RevitActiveQualityMonitor'
$addinFile  = Join-Path $addinsRoot 'RevitActiveQualityMonitor.addin'

Write-Host ''
Write-Host '=== Revit Active Quality Monitor Uninstaller ===' -ForegroundColor Cyan
Write-Host ''

$removed = $false

if (Test-Path $pluginDir) {
    Write-Host "Removing plugin folder: $pluginDir"
    Remove-Item $pluginDir -Recurse -Force
    $removed = $true
}

if (Test-Path $addinFile) {
    Write-Host "Removing manifest: $addinFile"
    Remove-Item $addinFile -Force
    $removed = $true
}

if ($removed) {
    Write-Host ''
    Write-Host 'Uninstallation complete.' -ForegroundColor Green
    Write-Host 'Please restart Revit 2026.' -ForegroundColor Green
} else {
    Write-Host 'Nothing to uninstall — plugin files were not found.' -ForegroundColor Yellow
}

Write-Host ''
