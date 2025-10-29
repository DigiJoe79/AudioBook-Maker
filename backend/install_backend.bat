@echo off
REM Backend Installation Script for Audiobook Maker
REM Requires Python 3.10 installed and added to PATH

echo ========================================
echo Audiobook Maker - Backend Installation
echo ========================================
echo.

REM Check if we're in the backend directory
if not exist "requirements.txt" (
    echo ERROR: requirements.txt not found!
    echo Please run this script from the backend directory.
    pause
    exit /b 1
)

REM Check if venv already exists
if exist "venv\" (
    echo Virtual environment already exists.
    echo Delete the 'venv' folder first if you want a fresh installation.
    pause
    exit /b 1
)

echo [1/5] Creating virtual environment with Python 3.10...
python3.10 -m venv venv
if %errorlevel% neq 0 (
    echo ERROR: Failed to create virtual environment!
    echo Make sure Python 3.10 is installed and added to PATH.
    pause
    exit /b 1
)

echo.
echo [2/5] Activating virtual environment...
call venv\Scripts\activate.bat

echo.
echo [3/5] Upgrading pip...
python -m pip install --upgrade pip

echo.
echo [4/5] Installing PyTorch with CUDA 12.1 support...
echo This may take a while (downloading ~2-3 GB)...
pip install torch==2.1.1+cu121 torchaudio==2.1.1+cu121 --index-url https://download.pytorch.org/whl/cu121
if %errorlevel% neq 0 (
    echo ERROR: Failed to install PyTorch!
    pause
    exit /b 1
)

echo.
echo [5/5] Installing remaining dependencies from requirements.txt...
echo Note: This may take 10-15 minutes and will download several GB of data
pip install -r requirements.txt --prefer-binary
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies!
    echo Check the error messages above for details.
    pause
    exit /b 1
)

echo.
echo ========================================
echo [6/6] Downloading models...
echo ========================================
echo Installing German language model (de_core_news_sm)...
python -m pip install https://github.com/explosion/spacy-models/releases/download/de_core_news_sm-3.7.0/de_core_news_sm-3.7.0-py3-none-any.whl
if %errorlevel% neq 0 (
    echo WARNING: Failed to install German spaCy model!
)

echo Installing English language model (en_core_web_sm)...
python -m pip install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.7.1/en_core_web_sm-3.7.1-py3-none-any.whl
if %errorlevel% neq 0 (
    echo WARNING: Failed to install English spaCy model!
)

echo Installing XTTS model (v.2.0.2)...
python install_xtts_models.py
if %errorlevel% neq 0 (
    echo WARNING: Failed to install XTTS model!
)

echo.
echo ========================================
echo Installation completed successfully!
echo ========================================
echo.
echo To start the backend server:
echo   1. Activate the virtual environment: venv\Scripts\activate.bat
echo   2. Run: python main.py
echo.
echo Or use the start_backend.bat script (if available)
echo.
pause
