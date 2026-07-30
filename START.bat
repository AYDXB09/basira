@echo off
rem ===========================================================================
rem START.bat — launch for the Voice Tutor.
rem   1. bridge: neural voice + Classroom connector   127.0.0.1:8790
rem   2. web server                                   localhost:8124
rem   3. Edge/Chrome with autoplay allowed so it SPEAKS immediately.
rem FIRST RUN ONLY: click "Allow" on the microphone prompt once —
rem Chrome remembers it for localhost forever after.
rem ===========================================================================
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  set "PY=py"
) else (
  set "PY=python"
)
start "bridge" /min %PY% bridge\bridge.py
start "web" /min %PY% -m http.server 8124
timeout /t 2 /nobreak >nul
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --autoplay-policy=no-user-gesture-required "http://localhost:8124"
) else (
  start chrome --autoplay-policy=no-user-gesture-required "http://localhost:8124"
)
