@echo off
REM Template STT Engine Setup Script (Windows)
REM
REM This script creates a virtual environment and installs dependencies

echo ========================================
echo Template STT Engine Setup
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

REM Ask about CUDA (uncomment if your engine uses PyTorch)
REM echo Select PyTorch installation:
REM echo   [1] CPU only (default)
REM echo   [2] CUDA 12.6 (RTX 30/40/50 series)
REM echo   [3] CUDA 12.8 (latest stable)
REM echo   [4] CUDA 13.0 (newest)
REM echo.
REM set /p CUDA_CHOICE="Enter choice (1-4) [1]: "
REM
REM if "%CUDA_CHOICE%"=="" set CUDA_CHOICE=1
REM if "%CUDA_CHOICE%"=="1" set TORCH_INDEX=https://download.pytorch.org/whl/cpu
REM if "%CUDA_CHOICE%"=="2" set TORCH_INDEX=https://download.pytorch.org/whl/cu126
REM if "%CUDA_CHOICE%"=="3" set TORCH_INDEX=https://download.pytorch.org/whl/cu128
REM if "%CUDA_CHOICE%"=="4" set TORCH_INDEX=https://download.pytorch.org/whl/cu130

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
python -m pip install --upgrade pip

REM If using PyTorch with CUDA, uncomment these lines:
REM echo Installing PyTorch...
REM pip install torch torchaudio --extra-index-url %TORCH_INDEX%

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
echo   venv\Scripts\python.exe server.py --port 8767
echo.
pause
