@echo off
setlocal enabledelayedexpansion
echo Starting Yuuka's Character Gallery Server...
set "MAX_FAILURES=5"
set "FAIL_COUNT=0"

:restart
cls
py main.py
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" (
    set "FAIL_COUNT=0"
    echo Application exited cleanly. Restarting...
    timeout /t 1 /nobreak >nul
    goto restart
)

if "%EXIT_CODE%"=="2" (
    set "FAIL_COUNT=0"
    echo Application requested graceful restart. Restarting...
    timeout /t 1 /nobreak >nul
    goto restart
)

set /a FAIL_COUNT+=1
echo Application exited with error level %EXIT_CODE% (attempt !FAIL_COUNT! of !MAX_FAILURES!).
if !FAIL_COUNT! GEQ !MAX_FAILURES! (
    echo Reached the maximum number of automatic restart attempts.
    echo Press any key to try again, or close this window to stop.
    pause
    set "FAIL_COUNT=0"
) else (
    echo Retrying automatically in 3 seconds...
    timeout /t 3 /nobreak >nul
)
goto restart
