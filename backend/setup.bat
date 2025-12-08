@echo off
REM Backend Core Setup Script (Windows)
REM
REM This script creates a virtual environment and installs backend dependencies
REM WITHOUT XTTS/PyTorch (engines run in separate VENVs)

echo ========================================
echo Audiobook Maker - Backend Setup
echo ========================================
echo.

REM Check if venv already exists
if exist venv (
    echo Virtual environment already exists!
    echo To recreate, delete the 'venv' folder first.
    pause
    exit /b 1
)

echo Checking Python version...
python --version
if errorlevel 1 (
    echo ERROR: Python not found in PATH
    echo Please install Python 3.10 or higher
    pause
    exit /b 1
)
echo.

echo Creating virtual environment...
python -m venv venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment
    pause
    exit /b 1
)

echo.
echo Activating virtual environment...
call venv\Scripts\activate.bat

echo.
echo Upgrading pip...
python -m pip install --upgrade pip

echo.
echo Installing backend dependencies...
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
echo Next steps:
echo   1. Setup TTS engine: engines\tts\xtts\setup.bat
echo   2. Setup Text engine: engines\text_processing\spacy\setup.bat
echo   3. Start backend: venv\Scripts\python.exe main.py
echo.
echo Note: All engines run in separate VENVs
echo.
pause
