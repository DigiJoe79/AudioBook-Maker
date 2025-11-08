#!/bin/bash
# Backend Core Setup Script (Linux/Mac)
#
# This script creates a virtual environment and installs backend dependencies
# WITHOUT XTTS/PyTorch (engines run in separate VENVs)

echo "========================================"
echo "Audiobook Maker - Backend Setup"
echo "========================================"
echo

# Check if venv already exists
if [ -d "venv" ]; then
    echo "Virtual environment already exists!"
    echo "To recreate, delete the 'venv' folder first."
    exit 1
fi

echo "Checking Python version..."
python3 --version
if [ $? -ne 0 ]; then
    echo "ERROR: Python3 not found"
    echo "Please install Python 3.10 or higher"
    exit 1
fi
echo

echo "Creating virtual environment..."
python3 -m venv venv
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create virtual environment"
    exit 1
fi

echo
echo "Activating virtual environment..."
source venv/bin/activate

echo
echo "Upgrading pip..."
python -m pip install --upgrade pip

echo
echo "Installing backend dependencies..."
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install dependencies"
    exit 1
fi

echo
echo "Downloading spaCy language models..."
echo "- German (de_core_news_sm)"
python -m spacy download de_core_news_sm
echo "- English (en_core_web_sm)"
python -m spacy download en_core_web_sm

echo
echo "========================================"
echo "Setup complete!"
echo "========================================"
echo
echo "Virtual environment created at: venv/"
echo "Python executable: venv/bin/python"
echo
echo "Next steps:"
echo "  1. Setup engine servers (e.g., engines/xtts/setup.sh)"
echo "  2. Start backend: venv/bin/python main.py"
echo
echo "Note: TTS engines run in separate VENVs (no PyTorch in core backend)"
echo
