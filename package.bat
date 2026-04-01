@echo off
setlocal

echo Building RevitActiveQualityMonitor (Release)...
dotnet build -c Release
if %errorlevel% neq 0 (
    echo Build failed. Please check errors above.
    exit /b %errorlevel%
)

echo.
echo Packaging...

set STAGING_DIR=staging
if exist "%STAGING_DIR%" rmdir /s /q "%STAGING_DIR%"
mkdir "%STAGING_DIR%"
mkdir "%STAGING_DIR%\RevitActiveQualityMonitor"

:: Copy binaries and UI
xcopy "bin\Release\*" "%STAGING_DIR%\RevitActiveQualityMonitor\" /Y /E /I

:: Copy manifest and installer scripts
copy /y "RevitActiveQualityMonitor.addin" "%STAGING_DIR%\"
copy /y "Install.ps1" "%STAGING_DIR%\"
copy /y "Uninstall.ps1" "%STAGING_DIR%\"

:: Read version from csproj
for /f "tokens=2 delims=><" %%A in ('findstr "<Version>" RevitActiveQualityMonitor.csproj') do set VERSION=%%A

set ZIP_NAME=RevitActiveQualityMonitor-v%VERSION%.zip

if exist "%ZIP_NAME%" del "%ZIP_NAME%"
powershell -Command "Compress-Archive -Path '%STAGING_DIR%\*' -DestinationPath '%ZIP_NAME%'"

rmdir /s /q "%STAGING_DIR%"

echo.
echo Package created: %ZIP_NAME%
echo.
