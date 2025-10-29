@echo off
echo ========================================
echo FastAPI Backend Starter
echo ========================================
echo.
echo Activating virtual environment...
call venv\Scripts\activate.bat

if errorlevel 1 (
    echo FEHLER: Virtual Environment konnte nicht aktiviert werden!
    echo Stellen Sie sicher, dass venv existiert.
    pause
    exit /b 1
)

echo Starting FastAPI Backend on http://127.0.0.1:8765 ...
echo.
python main.py --enable-dummy

if errorlevel 1 (
    echo.
    echo FEHLER: Backend konnte nicht gestartet werden!
    pause
    exit /b 1
)

pause