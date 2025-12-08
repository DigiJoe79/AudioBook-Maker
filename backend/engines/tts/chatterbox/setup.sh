#!/bin/bash
# Chatterbox Engine Setup Script (Linux/Mac)
#
# This script creates a virtual environment and installs Chatterbox dependencies

echo "========================================"
echo "Chatterbox Multilingual TTS Engine Setup"
echo "========================================"
echo ""

# Check if venv already exists
if [ -d "venv" ]; then
    echo "Virtual environment already exists!"
    echo "To recreate, delete the 'venv' folder first."
    exit 1
fi

# Read Python version from engine.yaml
echo "Reading Python version requirement from engine.yaml..."
PYTHON_VERSION=$(grep "python_version:" engine.yaml | awk '{print $2}' | tr -d '"')

if [ -z "$PYTHON_VERSION" ]; then
    echo "WARNING: Could not read python_version from engine.yaml"
    echo "Falling back to python3.12"
    PYTHON_VERSION="3.12"
fi

echo "Using Python $PYTHON_VERSION"
echo ""

# Try different Python executable names
PYTHON_CMD=""
for cmd in python$PYTHON_VERSION python3 python; do
    if command -v $cmd &> /dev/null; then
        PYTHON_CMD=$cmd
        break
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo "ERROR: Python $PYTHON_VERSION not found"
    exit 1
fi

echo "Creating virtual environment..."
$PYTHON_CMD -m venv venv
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create virtual environment"
    exit 1
fi

echo ""
echo "Installing dependencies..."
source venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install dependencies"
    exit 1
fi

echo ""
echo "========================================"
echo "Setup complete!"
echo "========================================"
echo ""
echo "Virtual environment created at: venv/"
echo "Python executable: venv/bin/python"
echo ""
echo "NOTE: The Chatterbox model (~2GB) will download automatically"
echo "      on first use. This may take a few minutes."
echo ""
echo "To test the engine server:"
echo "  venv/bin/python server.py --port 8766"
echo ""
