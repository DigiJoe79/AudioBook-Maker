#!/bin/bash
# Template STT Engine Setup Script (Linux/Mac)
#
# This script creates a virtual environment and installs dependencies

echo "========================================"
echo "Template STT Engine Setup"
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
    echo "Falling back to python3.12"
    PYTHON_VERSION="3.12"
fi

echo "Using Python $PYTHON_VERSION"
echo

# Ask about CUDA (uncomment if your engine uses PyTorch)
# echo "Select PyTorch installation:"
# echo "  [1] CPU only (default)"
# echo "  [2] CUDA 12.6 (RTX 30/40/50 series)"
# echo "  [3] CUDA 12.8 (latest stable)"
# echo "  [4] CUDA 13.0 (newest)"
# echo
# read -p "Enter choice (1-4) [1]: " CUDA_CHOICE
#
# CUDA_CHOICE=${CUDA_CHOICE:-1}
# case $CUDA_CHOICE in
#     1) TORCH_INDEX="https://download.pytorch.org/whl/cpu" ;;
#     2) TORCH_INDEX="https://download.pytorch.org/whl/cu126" ;;
#     3) TORCH_INDEX="https://download.pytorch.org/whl/cu128" ;;
#     4) TORCH_INDEX="https://download.pytorch.org/whl/cu130" ;;
#     *) TORCH_INDEX="https://download.pytorch.org/whl/cpu" ;;
# esac

echo "Creating virtual environment..."
python${PYTHON_VERSION} -m venv venv
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create virtual environment"
    echo "Make sure Python $PYTHON_VERSION is installed"
    exit 1
fi

echo
echo "Installing dependencies..."
source venv/bin/activate
python -m pip install --upgrade pip

# If using PyTorch with CUDA, uncomment these lines:
# echo "Installing PyTorch..."
# pip install torch torchaudio --extra-index-url $TORCH_INDEX

pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install dependencies"
    exit 1
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
echo "  venv/bin/python server.py --port 8767"
echo
