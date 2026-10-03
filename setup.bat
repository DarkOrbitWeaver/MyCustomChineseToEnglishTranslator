@echo off
REM LiveSubs one-time setup: creates server\.venv and installs everything.
REM Needs: Python 3.12/3.13 + ffmpeg + Node.js already installed (see README).
cd /d "%~dp0server"
python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
echo.
echo Setup done. Next: load a model in LM Studio, then run start.bat
pause
