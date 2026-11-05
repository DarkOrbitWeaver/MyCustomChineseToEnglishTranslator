@echo off
REM LiveSubs one-time setup: creates server\.venv, installs packages via fast uv installer, and caches ASR models.
REM Needs: Python 3.12/3.13 + ffmpeg + Node.js already installed (see README).
cd /d "%~dp0server"

if not exist ".venv" (
    echo [LiveSubs] Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip uv

echo [LiveSubs] Installing PyTorch with CUDA 12.4 via uv...
uv pip install torch --index-url https://download.pytorch.org/whl/cu124

echo [LiveSubs] Installing project requirements via uv...
uv pip install -r requirements.txt

if not exist "config.json" (
    if exist "config.example.json" (
        copy "config.example.json" "config.json" >nul
        echo [LiveSubs] Created server\config.json
    )
)

echo [LiveSubs] Pre-downloading and verifying ASR models...
python download_models.py

echo.
echo ======================================================================
echo  Setup Complete!
echo  - To use NVIDIA API: Add your key in server\config.json (or enter on launch)
echo  - To use Local LLM: Open LM Studio, load model, and start server
echo  Next: Run start.bat
echo ======================================================================
pause
