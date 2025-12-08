#!/bin/bash
# XTTS Engine Setup Script (Linux/Mac)
#
# This script creates a virtual environment and installs XTTS dependencies

echo "========================================"
echo "XTTS Engine Setup"
echo "========================================"
echo

# Check if venv already exists
if [ -d "venv" ]; then
    echo "Virtual environment already exists!"
    echo "To recreate, delete the 'venv' folder first."
    exit 1
fi

# Read Python version from engine.yaml
echo "Reading Python version requirement from engine.yaml..."
PYTHON_VERSION=$(grep "python_version:" engine.yaml | sed 's/.*: *"\(.*\)".*/\1/')

if [ -z "$PYTHON_VERSION" ]; then
    echo "WARNING: Could not read python_version from engine.yaml"
    echo "Falling back to python3.10"
    PYTHON_VERSION="3.10"
fi

echo "Using Python $PYTHON_VERSION"
echo

echo "Creating virtual environment..."
python$PYTHON_VERSION -m venv venv
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create virtual environment"
    exit 1
fi

echo
echo "Installing dependencies..."
source venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install dependencies"
    exit 1
fi

echo
echo "Downloading XTTS models..."
python install_models.py
if [ $? -ne 0 ]; then
    echo "WARNING: Model download failed. You may need to download models manually."
    echo
fi

echo
echo "========================================"
echo "Setup complete!"
echo "========================================"
echo
echo "Virtual environment created at: venv/"
echo "Python executable: venv/bin/python"
echo
echo "To test the engine server:"
echo "  venv/bin/python server.py --port 8766"
echo
