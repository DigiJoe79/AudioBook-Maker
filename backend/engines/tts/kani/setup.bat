@echo off
REM Kani TTS Engine Setup Script (Windows)
REM
REM Based on: https://github.com/nineninesix-ai/kani-tts

echo ========================================
echo Kani TTS Engine Setup
echo ========================================
echo.
echo NOTE: Requires Python 3.11+ and CUDA GPU (recommended)
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
    echo Falling back to python3.11
    set PYTHON_VERSION=3.11
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
echo Activating virtual environment...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip

echo.
echo ========================================
echo Step 1: Installing PyTorch with CUDA 12.1
echo ========================================
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
if errorlevel 1 (
    echo WARNING: CUDA installation failed, trying CPU-only PyTorch...
    pip install torch torchaudio
)

echo.
echo ========================================
echo Step 2: Installing core dependencies
echo ========================================
pip install fastapi==0.109.2 uvicorn==0.27.0 pydantic==2.6.1 loguru==0.7.2 httpx==0.26.0
pip install scipy numpy librosa soundfile huggingface_hub

echo.
echo ========================================
echo Step 3: Installing NeMo toolkit (TTS only)
echo ========================================
REM Use nemo_toolkit[tts] instead of [all] to avoid Linux-only NVIDIA packages
pip install "nemo_toolkit[tts]"

echo.
echo ========================================
echo Step 4: Installing Transformers (custom build for LFM2)
echo ========================================
REM Kani TTS requires a newer transformers version for lfm2 model support
pip install -U "git+https://github.com/huggingface/transformers.git"

echo.
echo ========================================
echo Step 5: Installing kani-tts
echo ========================================
pip install kani-tts

if errorlevel 1 (
    echo.
    echo ========================================
    echo WARNING: Installation may have issues.
    echo ========================================
    echo.
    echo If you encounter errors, check:
    echo - CUDA version compatibility
    echo - Python version (must be 3.11+)
    echo - Available disk space (~5GB needed)
    echo.
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
