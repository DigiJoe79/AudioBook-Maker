#!/bin/bash

echo "========================================"
echo "spaCy Text Processing Engine Setup"
echo "========================================"
echo
echo "CPU-only with MD models (balanced speed/accuracy)"
echo

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python3 not found! Please install Python 3.10 or higher."
    exit 1
fi

# ==================== Language Selection ====================
echo "Select languages to install:"
echo
echo "  de - German          en - English         es - Spanish"
echo "  fr - French          it - Italian         nl - Dutch"
echo "  pl - Polish          pt - Portuguese      ru - Russian"
echo "  zh - Chinese         ja - Japanese"
echo
echo "Enter language codes separated by spaces (e.g., \"de en\")"
echo "Or press Enter for default (de en):"
echo
read -p "Languages: " LANG_INPUT

if [ -z "$LANG_INPUT" ]; then
    LANGUAGES="de en"
else
    LANGUAGES="$LANG_INPUT"
fi

echo
echo "Languages: $LANGUAGES"
echo

# ==================== Create VENV ====================
echo "[1/4] Creating virtual environment..."
if [ -d "venv" ]; then
    echo "Removing existing venv..."
    rm -rf venv
fi
python3 -m venv venv
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create virtual environment"
    exit 1
fi

echo "[2/4] Activating virtual environment..."
source venv/bin/activate
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to activate virtual environment"
    exit 1
fi

# ==================== Install Dependencies ====================
echo "[3/4] Installing dependencies..."
python -m pip install --upgrade pip
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install dependencies"
    exit 1
fi

# ==================== Download Language Models ====================
echo "[4/4] Downloading spaCy language models (MD tier)..."

declare -A MD_MODELS=(
    ["de"]="de_core_news_md" ["en"]="en_core_web_md" ["es"]="es_core_news_md"
    ["fr"]="fr_core_news_md" ["it"]="it_core_news_md" ["nl"]="nl_core_news_md"
    ["pl"]="pl_core_news_md" ["pt"]="pt_core_news_md" ["ru"]="ru_core_news_md"
    ["zh"]="zh_core_web_md" ["ja"]="ja_core_news_md"
)

for LANG in $LANGUAGES; do
    MODEL_NAME="${MD_MODELS[$LANG]}"
    if [ -n "$MODEL_NAME" ]; then
        echo "  Downloading $MODEL_NAME..."
        python -m spacy download "$MODEL_NAME" || echo "  WARNING: Failed to download $MODEL_NAME"
    else
        echo "  WARNING: Unknown language code: $LANG"
    fi
done

# ==================== Verify Installation ====================
echo
echo "Verifying installation..."
python -c "import spacy; print(f'spaCy version: {spacy.__version__}'); models = spacy.util.get_installed_models(); print(f'Installed models ({len(models)}): {list(models)}')"

echo
echo "========================================"
echo "Setup Complete!"
echo "========================================"
echo
echo "To add more languages later:"
echo "  venv/bin/python -m spacy download [lang]_core_news_md"
echo
echo "Backend will automatically discover this engine on restart."
echo
