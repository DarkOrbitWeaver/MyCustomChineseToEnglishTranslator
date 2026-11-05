@echo off
REM LiveSubs Daily Launcher
REM Supports NVIDIA API (Nemotron 3.5 Bolt E4B / Lightning) and local LM Studio.
REM Configure settings in server\config.json or pass environment variables.
cd /d "%~dp0server"

if not exist "config.json" (
    if exist "config.example.json" (
        copy "config.example.json" "config.json" >nul
        echo [LiveSubs] Created server\config.json from template.
    )
)

if not exist ".venv\Scripts\python.exe" (
    echo [!] Virtual environment not found. Please run setup.bat first!
    pause
    exit /b 1
)

echo ======================================================================
echo  LiveSubs Backend Starting...
echo  Config: server\config.json
echo ======================================================================

.\.venv\Scripts\python.exe -u server.py
if errorlevel 1 (
    echo.
    echo LiveSubs stopped with an error. Check dev.log or console output above.
)
pause
