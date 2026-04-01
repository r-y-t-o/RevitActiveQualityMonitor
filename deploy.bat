@echo off
setlocal

echo Building RevitActiveQualityMonitor...
dotnet build -c Debug
if %errorlevel% neq 0 (
    echo Build failed. Please check errors above.
    exit /b %errorlevel%
)

echo.
echo Deploying to Revit 2026 Addins folder...
set "ADDIN_ROOT=%AppData%\Autodesk\Revit\Addins\2026"
set "ADDIN_DIR=%ADDIN_ROOT%\RevitActiveQualityMonitor"

if not exist "%ADDIN_DIR%" mkdir "%ADDIN_DIR%"

echo Copying binaries and UI...
xcopy /s /y /i "bin\Debug\*" "%ADDIN_DIR%\"

echo Copying manifest...
copy /y "RevitActiveQualityMonitor.addin" "%ADDIN_ROOT%\"

echo.
echo Deployment complete!
echo Please restart Revit 2026 to see the 'Quality Monitor' plugin.
