@echo off
setlocal enabledelayedexpansion

echo ========================================
echo spaCy Text Processing Engine Setup
echo ========================================
echo.
echo CPU-only with MD models (balanced speed/accuracy)
echo.

REM Check Python version
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found! Please install Python 3.10 or higher.
    pause
    exit /b 1
)

REM ==================== Language Selection ====================
echo Select languages to install:
echo.
echo   de - German          en - English         es - Spanish
echo   fr - French          it - Italian         nl - Dutch
echo   pl - Polish          pt - Portuguese      ru - Russian
echo   zh - Chinese         ja - Japanese
echo.
echo Enter language codes separated by spaces (e.g., "de en")
echo Or press Enter for default (de en):
echo.
set /p LANG_INPUT="Languages: "

if "%LANG_INPUT%"=="" (
    set LANGUAGES=de en
) else (
    set LANGUAGES=%LANG_INPUT%
)

echo.
echo Languages: %LANGUAGES%
echo.

REM ==================== Create VENV ====================
echo [1/4] Creating virtual environment...
if exist venv (
    echo Removing existing venv...
    rmdir /s /q venv
)
python -m venv venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment
    pause
    exit /b 1
)

echo [2/4] Activating virtual environment...
call venv\Scripts\activate.bat
if errorlevel 1 (
    echo ERROR: Failed to activate virtual environment
    pause
    exit /b 1
)

REM ==================== Install Dependencies ====================
echo [3/4] Installing dependencies...
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

REM ==================== Download Language Models ====================
echo [4/4] Downloading spaCy language models (MD tier)...

REM MD model names per language
set MD_de=de_core_news_md
set MD_en=en_core_web_md
set MD_es=es_core_news_md
set MD_fr=fr_core_news_md
set MD_it=it_core_news_md
set MD_nl=nl_core_news_md
set MD_pl=pl_core_news_md
set MD_pt=pt_core_news_md
set MD_ru=ru_core_news_md
set MD_zh=zh_core_web_md
set MD_ja=ja_core_news_md

for %%L in (%LANGUAGES%) do (
    set MODEL_VAR=MD_%%L
    call set MODEL_NAME=%%!MODEL_VAR!%%

    if defined MODEL_NAME (
        echo   Downloading !MODEL_NAME!...
        python -m spacy download !MODEL_NAME!
        if errorlevel 1 (
            echo   WARNING: Failed to download !MODEL_NAME!
        )
    ) else (
        echo   WARNING: Unknown language code: %%L
    )
)

REM ==================== Verify Installation ====================
echo.
echo Verifying installation...
python -c "import spacy; print(f'spaCy version: {spacy.__version__}'); models = spacy.util.get_installed_models(); print(f'Installed models ({len(models)}): {list(models)}')"

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo To add more languages later:
echo   venv\Scripts\python.exe -m spacy download [lang]_core_news_md
echo.
echo Backend will automatically discover this engine on restart.
echo.
pause
