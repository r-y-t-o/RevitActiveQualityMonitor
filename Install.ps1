#Requires -Version 5.1
<#
.SYNOPSIS
    Installs Revit Active Quality Monitor for Revit 2026.
.DESCRIPTION
    Copies the plugin files to the Revit 2026 addins folder and places the
    manifest (.addin) file so Revit loads the plugin on next startup.
#>

$ErrorActionPreference = 'Stop'

$addinsRoot = Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2026'
$pluginDir  = Join-Path $addinsRoot 'RevitActiveQualityMonitor'
$addinFile  = Join-Path $addinsRoot 'RevitActiveQualityMonitor.addin'

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDir  = Join-Path $scriptDir 'RevitActiveQualityMonitor'
$sourceAddin = Join-Path $scriptDir 'RevitActiveQualityMonitor.addin'

Write-Host ''
Write-Host '=== Revit Active Quality Monitor Installer ===' -ForegroundColor Cyan
Write-Host ''

# Validate source files
if (-not (Test-Path $sourceDir)) {
    Write-Error "Could not find plugin folder '$sourceDir'. Make sure you are running Install.ps1 from the extracted ZIP directory."
}
if (-not (Test-Path $sourceAddin)) {
    Write-Error "Could not find 'RevitActiveQualityMonitor.addin'. Make sure you are running Install.ps1 from the extracted ZIP directory."
}

# Create target directories if needed
if (-not (Test-Path $addinsRoot)) {
    New-Item -ItemType Directory -Path $addinsRoot -Force | Out-Null
}

Write-Host "Installing to: $addinsRoot" -ForegroundColor Yellow
Write-Host ''

# Copy plugin binaries
Write-Host 'Copying plugin files...'
if (Test-Path $pluginDir) { Remove-Item $pluginDir -Recurse -Force }
Copy-Item -Path $sourceDir -Destination $pluginDir -Recurse -Force

# Copy manifest
Write-Host 'Copying manifest...'
Copy-Item -Path $sourceAddin -Destination $addinFile -Force

Write-Host ''
Write-Host 'Installation complete!' -ForegroundColor Green
Write-Host 'Please restart Revit 2026. The Quality Monitor panel will appear under Add-ins.' -ForegroundColor Green
Write-Host ''
