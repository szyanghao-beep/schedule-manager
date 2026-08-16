@echo off
rem Schedule Manager sync backend launcher (Windows)
rem Double-click this file to start the backend on 0.0.0.0:8787
cd /d "%~dp0server"
echo Starting Schedule Manager sync backend...
echo   Listen : http://0.0.0.0:8787
echo   Desktop: http://127.0.0.1:8787
echo   Phone  : http://LAN-IP:8787
echo.
echo Press Ctrl+C to stop.
echo.
node server.js
pause