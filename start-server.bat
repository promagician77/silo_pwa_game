@echo off
echo Starting local web server for SILO DERPLES PWA...
echo.
echo Server will be available at: http://localhost:8000
echo.
echo Press Ctrl+C to stop the server
echo.

REM Try Python 3 first
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo Using Python HTTP server...
    python -m http.server 8000
    goto :end
)

REM Try Python 2
python2 --version >nul 2>&1
if %errorlevel% == 0 (
    echo Using Python 2 HTTP server...
    python2 -m SimpleHTTPServer 8000
    goto :end
)

REM Try Node.js http-server
where npx >nul 2>&1
if %errorlevel% == 0 (
    echo Using Node.js http-server...
    npx --yes http-server -p 8000 -c-1
    goto :end
)

echo ERROR: No web server found!
echo.
echo Please install one of the following:
echo   1. Python 3 (https://www.python.org/downloads/)
echo   2. Node.js (https://nodejs.org/)
echo.
echo Or use VS Code Live Server extension
pause

:end


