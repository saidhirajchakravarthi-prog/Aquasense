@echo off
setlocal
set "ROOT=C:\Users\DELL\Downloads\SIH"

start "AquaSense Backend" cmd /k "cd /d %ROOT% && npm run server"
start "AquaSense Frontend" cmd /k "cd /d %ROOT% && npm run dev"
start "AquaSense Python AI" cmd /k "cd /d %ROOT%\ai-engine && ..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"

endlocal
