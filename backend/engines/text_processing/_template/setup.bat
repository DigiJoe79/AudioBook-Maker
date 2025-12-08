@echo off
REM Setup script for Template Text Processing Engine (Windows)
REM Creates virtual environment and installs dependencies

setlocal enabledelayedexpansion

echo ========================================
echo Template Text Processing Engine Setup
echo ========================================

REM Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM Check if Python is available
where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    exit /b 1
)

REM Get Python version
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo Found Python %PYTHON_VERSION%

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment
        exit /b 1
    )
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip

REM Install dependencies
echo Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    exit /b 1
)

echo ========================================
echo Setup complete!
echo ========================================
echo.
echo To activate the environment:
echo   venv\Scripts\activate
echo.
echo To start the server:
echo   venv\Scripts\python.exe server.py --port 8770
echo.

endlocal
