@echo off
setlocal
set "ROOT=C:\Users\DELL\Downloads\SIH"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = 'C:\Users\DELL\Downloads\SIH'; $targets = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','python.exe','python3.exe') -and ((($_.CommandLine -like ('*' + $root + '*server/src/index.ts*')) -or ($_.CommandLine -like ('*' + $root + '*vite*')) -or ($_.CommandLine -like '*-m uvicorn main:app --host 127.0.0.1 --port 8000*'))) }; if (-not $targets) { Write-Host 'No AquaSense application processes found.'; exit 0 }; foreach ($target in $targets) { Write-Host ('Stopping AquaSense process PID ' + $target.ProcessId + ': ' + $target.CommandLine); Stop-Process -Id $target.ProcessId -ErrorAction Continue }"

endlocal
