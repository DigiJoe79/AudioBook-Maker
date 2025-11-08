@echo off
REM Template Engine Setup Script (Windows)
REM
REM This script creates a virtual environment and installs engine dependencies

echo ========================================
echo Template Engine Setup
echo ========================================
echo.

REM Check if venv already exists
if exist venv (
    echo Virtual environment already exists!
    echo To recreate, delete the 'venv' folder first.
    pause
    exit /b 1
)

REM Read Python version from engine.yaml
echo Reading Python version requirement from engine.yaml...
for /f "tokens=2 delims=: " %%a in ('findstr /C:"python_version:" engine.yaml') do (
    set PYTHON_VERSION=%%a
)
REM Remove quotes from version string
set PYTHON_VERSION=%PYTHON_VERSION:"=%

if "%PYTHON_VERSION%"=="" (
    echo WARNING: Could not read python_version from engine.yaml
    echo Falling back to python3.10
    set PYTHON_VERSION=3.10
)

echo Using Python %PYTHON_VERSION%
echo.

echo Creating virtual environment...
python%PYTHON_VERSION% -m venv venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment
    echo.
    echo Please ensure Python %PYTHON_VERSION% is installed and in your PATH.
    echo You can download it from: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo.
echo Installing dependencies...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ========================================
echo Setup complete!
echo ========================================
echo.
echo Virtual environment created at: venv\
echo Python executable: venv\Scripts\python.exe
echo.
echo To test the engine server:
echo   venv\Scripts\python.exe server.py --port 8766
echo.
pause
