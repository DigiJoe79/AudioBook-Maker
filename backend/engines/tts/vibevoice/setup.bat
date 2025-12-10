@echo off
REM VibeVoice Engine Setup Script (Windows)
REM
REM This script creates a virtual environment and installs VibeVoice dependencies
REM Requires: Python 3.12, CUDA 13.0 (for GPU support), Git

echo ========================================
echo VibeVoice TTS Engine Setup
echo ========================================
echo.
echo NOTE: VibeVoice requires significant resources:
echo   - VibeVoice-1.5B: ~3GB VRAM
echo   - VibeVoice-7B: ~18GB VRAM
echo.

REM Check if venv already exists
if exist venv (
    echo Virtual environment already exists!
    echo To recreate, delete the 'venv' folder first.
    pause
    exit /b 1
)

REM Check if git is available
where git >nul 2>nul
if errorlevel 1 (
    echo ERROR: Git is required but not found in PATH
    echo Please install Git from https://git-scm.com/
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

REM Ask about Flash Attention installation
echo ========================================
echo Flash Attention 2 (Optional)
echo ========================================
echo.
echo Flash Attention 2 provides ~2x faster inference and ~40%% less VRAM usage.
echo However, it requires a ~240MB download.
echo.
set /p INSTALL_FLASH_ATTN="Install Flash Attention 2? (y/N): "
if /i "%INSTALL_FLASH_ATTN%"=="y" (
    set INSTALL_FLASH_ATTN=1
) else (
    set INSTALL_FLASH_ATTN=0
)
echo.

echo Creating virtual environment...
python%PYTHON_VERSION% -m venv venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment
    echo Make sure Python %PYTHON_VERSION% is installed and in PATH
    pause
    exit /b 1
)

echo.
echo Installing dependencies...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip setuptools wheel

REM Step 1: Install PyTorch with CUDA support FIRST
echo.
echo [1/5] Installing PyTorch 2.9.1 with CUDA 13.0 support...
pip install "torch==2.9.1" "torchaudio==2.9.1" --index-url https://download.pytorch.org/whl/cu130
if errorlevel 1 (
    echo WARNING: Failed to install PyTorch with CUDA
    echo Falling back to CPU-only installation...
    pip install "torch==2.9.1" "torchaudio==2.9.1"
)

REM Step 2: Install Flash Attention 2 (optional)
echo.
if "%INSTALL_FLASH_ATTN%"=="1" (
    echo [2/5] Installing Flash Attention 2 for Windows...
    echo Installing Triton for Windows...
    pip install "triton-windows<3.6"
    echo Downloading pre-built Flash Attention wheel from HuggingFace...
    pip install "https://huggingface.co/ussoewwin/Flash-Attention-2_for_Windows/resolve/main/flash_attn-2.8.3%%2Bcu130torch2.9.1cxx11abiTRUE-cp312-cp312-win_amd64.whl"
    if errorlevel 1 (
        echo WARNING: Failed to install Flash Attention 2
        echo Continuing without Flash Attention - SDPA will be used as fallback
    ) else (
        echo Flash Attention 2 installed successfully!
    )
) else (
    echo [2/5] Skipping Flash Attention 2 (SDPA will be used)
)

REM Step 3: Install VibeVoice from Community Fork (has voice cloning support)
echo.
echo [3/5] Installing VibeVoice from Community Fork (this may take a while)...
pip install "git+https://github.com/vibevoice-community/VibeVoice.git"
if errorlevel 1 (
    echo ERROR: Failed to install VibeVoice
    echo Make sure Git is installed and you have internet access
    pause
    exit /b 1
)

REM Step 4: Install additional audio dependencies
echo.
echo [4/5] Installing audio processing dependencies...
pip install librosa scipy numpy huggingface_hub
if errorlevel 1 (
    echo ERROR: Failed to install audio dependencies
    pause
    exit /b 1
)

REM Step 5: Install server dependencies
echo.
echo [5/5] Installing server dependencies...
pip install "fastapi>=0.109.0,<1.0.0" "uvicorn>=0.27.0,<1.0.0" "pydantic>=2.10.0,<3.0.0" "loguru>=0.7.2,<0.8.0" "httpx>=0.26.0,<1.0.0"
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
if "%INSTALL_FLASH_ATTN%"=="1" (
    echo Flash Attention 2: INSTALLED (faster inference)
) else (
    echo Flash Attention 2: NOT INSTALLED (using SDPA fallback)
)
echo.
echo NOTE: The VibeVoice models will download automatically on first use:
echo   - VibeVoice-1.5B: ~5GB download
echo   - VibeVoice-7B: ~20GB download
echo.
echo To test the engine server:
echo   venv\Scripts\python.exe server.py --port 8766
echo.
pause
