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
python -m pip install --upgrade pip setuptools wheel

REM Step 1: Install build dependencies (numpy, cython for pkuseg)
echo.
echo [1/4] Installing build dependencies (numpy, cython)...
pip install "numpy>=1.24.0,<1.26.0" cython
if errorlevel 1 (
    echo ERROR: Failed to install build dependencies
    pause
    exit /b 1
)

REM Step 2: Install PyTorch with CUDA support FIRST
REM chatterbox-tts pins torch==2.6.0, we install CUDA version before chatterbox
echo.
echo [2/4] Installing PyTorch 2.6.0 with CUDA 12.4 support...
pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
if errorlevel 1 (
    echo ERROR: Failed to install PyTorch with CUDA
    echo Falling back to CPU-only installation...
    pip install torch==2.6.0 torchaudio==2.6.0
)

REM Step 3: Install chatterbox-tts with --no-deps to preserve CUDA PyTorch
REM Then install its other dependencies separately
echo.
echo [3/4] Installing chatterbox-tts (this may take a while)...
pip install --no-build-isolation --no-deps "chatterbox-tts>=0.1.4,<0.2.0"
if errorlevel 1 (
    echo ERROR: Failed to install chatterbox-tts
    pause
    exit /b 1
)

REM Install chatterbox dependencies (except torch/torchaudio which we already have)
echo.
echo Installing chatterbox dependencies...
pip install --no-build-isolation transformers==4.46.3 diffusers==0.29.0 librosa==0.11.0 safetensors==0.5.3 conformer==0.3.2 resemble-perth==1.0.1 s3tokenizer pykakasi==2.3.0 spacy-pkuseg
if errorlevel 1 (
    echo ERROR: Failed to install chatterbox dependencies
    pause
    exit /b 1
)

REM Step 4: Install server dependencies
echo.
echo [4/4] Installing server dependencies...
pip install "fastapi>=0.115.0,<1.0.0" "uvicorn>=0.32.0,<1.0.0" "pydantic>=2.10.0,<3.0.0" "loguru>=0.7.2,<0.8.0" "httpx>=0.28.0,<1.0.0" "scipy>=1.11.0,<2.0.0"
if errorlevel 1 (
    echo ERROR: Failed to install server dependencies
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
