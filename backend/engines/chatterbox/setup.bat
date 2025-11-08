@echo off
REM Chatterbox Engine Setup Script (Windows)
REM
REM This script creates a virtual environment and installs Chatterbox dependencies

echo ========================================
echo Chatterbox Multilingual TTS Engine Setup
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
    echo Falling back to python3.12
    set PYTHON_VERSION=3.12
)

echo Using Python %PYTHON_VERSION%
echo.

echo Creating virtual environment...
python%PYTHON_VERSION% -m venv venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment
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
echo NOTE: The Chatterbox model (~2GB) will download automatically
echo       on first use. This may take a few minutes.
echo.
echo To test the engine server:
echo   venv\Scripts\python.exe server.py --port 8766
echo.
pause
