@echo off
REM LiveSubs daily launcher. Double-click this after LM Studio is serving a model.
REM Override defaults per window, e.g.:  set LLM_MODEL=my-model  ^&  start.bat
cd /d "%~dp0server"
if not defined ASR_MODEL set ASR_MODEL=Qwen/Qwen3-ASR-0.6B
if not defined LLM_MODEL set LLM_MODEL=qwen3-4b-instruct-2507
if not defined CPS set CPS=17
echo ASR=%ASR_MODEL%  LLM=%LLM_MODEL%  CPS=%CPS%
.\.venv\Scripts\python.exe -u server.py
pause
