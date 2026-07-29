@echo off
rem ============================================================================
rem START-CHROME-DEBUG.bat
rem Starts YOUR Chrome with remote debugging so Basira can control the
rem same browser you already use (tabs + Google login).
rem
rem IMPORTANT:
rem   Chrome can only load a profile once. Close ALL Chrome windows first
rem   (tray icon too), then run this. After that, use Chrome as normal —
rem   Basira attaches to it on port 9222.
rem ============================================================================
cd /d "%~dp0"

echo Closing existing Chrome...
taskkill /IM chrome.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if "%CHROME%"=="" (
  echo Chrome not found.
  pause
  exit /b 1
)

echo Starting Chrome with debugging on port 9222 using your normal profile...
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" --profile-directory=Default

echo.
echo Done. Keep this Chrome open. Then open Basira and say: connect my classroom
echo.
timeout /t 4 >nul
