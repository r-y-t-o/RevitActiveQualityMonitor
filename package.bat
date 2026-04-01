@echo off
setlocal

:: ---------------------------------------------------------------
:: Revit Active Quality Monitor — local build + GitHub release
:: Usage: package.bat
:: Requires: dotnet CLI, git, gh CLI (authenticated)
:: ---------------------------------------------------------------

echo Building RevitActiveQualityMonitor (Release)...
dotnet build -c Release
if %errorlevel% neq 0 (
    echo Build failed. Please check errors above.
    exit /b %errorlevel%
)

:: Read version from csproj
for /f "tokens=2 delims=><" %%A in ('findstr "<Version>" RevitActiveQualityMonitor.csproj') do set VERSION=%%A
set TAG=v%VERSION%
set ZIP_NAME=RevitActiveQualityMonitor-%TAG%.zip

echo.
echo Packaging %ZIP_NAME%...

set STAGING_DIR=staging
if exist "%STAGING_DIR%" rmdir /s /q "%STAGING_DIR%"
mkdir "%STAGING_DIR%"
mkdir "%STAGING_DIR%\RevitActiveQualityMonitor"

xcopy "bin\Release\*"               "%STAGING_DIR%\RevitActiveQualityMonitor\" /Y /E /I /Q
copy /y "RevitActiveQualityMonitor.addin" "%STAGING_DIR%\" >nul
copy /y "Install.ps1"   "%STAGING_DIR%\" >nul
copy /y "Uninstall.ps1" "%STAGING_DIR%\" >nul

if exist "%ZIP_NAME%" del "%ZIP_NAME%"
powershell -Command "Compress-Archive -Path '%STAGING_DIR%\*' -DestinationPath '%ZIP_NAME%'"
rmdir /s /q "%STAGING_DIR%"

echo Package created: %ZIP_NAME%

:: Tag and push
echo.
echo Tagging and publishing to GitHub...

git tag %TAG% 2>nul
if %errorlevel% neq 0 (
    echo Tag %TAG% already exists locally — skipping tag creation.
)

git push origin %TAG% 2>nul

:: Create GitHub Release and upload ZIP
gh release create %TAG% "%ZIP_NAME%" --title "Revit Active Quality Monitor %TAG%" --generate-notes
if %errorlevel% neq 0 (
    echo.
    echo GitHub release creation failed. You can create it manually:
    echo   gh release create %TAG% "%ZIP_NAME%" --title "Revit Active Quality Monitor %TAG%"
)

echo.
echo Done! Release %TAG% is live on GitHub.
echo.
