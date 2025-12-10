#!/bin/bash
# VibeVoice Engine Setup Script (Linux/Mac)
#
# This script creates a virtual environment and installs VibeVoice dependencies
# Requires: Python 3.12, CUDA 13.0 (for GPU support), Git

echo "========================================"
echo "VibeVoice TTS Engine Setup"
echo "========================================"
echo ""
echo "NOTE: VibeVoice requires significant resources:"
echo "  - VibeVoice-1.5B: ~3GB VRAM"
echo "  - VibeVoice-7B: ~18GB VRAM"
echo ""

# Check if venv already exists
if [ -d "venv" ]; then
    echo "Virtual environment already exists!"
    echo "To recreate, delete the 'venv' folder first."
    exit 1
fi

# Check if git is available
if ! command -v git &> /dev/null; then
    echo "ERROR: Git is required but not found"
    echo "Please install Git first"
    exit 1
fi

# Read Python version from engine.yaml
echo "Reading Python version requirement from engine.yaml..."
PYTHON_VERSION=$(grep "python_version:" engine.yaml | awk '{print $2}' | tr -d '"')

if [ -z "$PYTHON_VERSION" ]; then
    echo "WARNING: Could not read python_version from engine.yaml"
    echo "Falling back to python3.10"
    PYTHON_VERSION="3.10"
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
python -m pip install --upgrade pip setuptools wheel

# Step 1: Install PyTorch with CUDA support
echo ""
echo "[1/4] Installing PyTorch 2.9.1 with CUDA 13.0 support..."
pip install "torch==2.9.1" "torchaudio==2.9.1" --index-url https://download.pytorch.org/whl/cu130
if [ $? -ne 0 ]; then
    echo "WARNING: Failed to install PyTorch with CUDA"
    echo "Falling back to CPU-only installation..."
    pip install "torch==2.9.1" "torchaudio==2.9.1"
fi

# Step 2: Install VibeVoice from Community Fork (has voice cloning support)
echo ""
echo "[2/4] Installing VibeVoice from Community Fork (this may take a while)..."
pip install "git+https://github.com/vibevoice-community/VibeVoice.git"
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install VibeVoice"
    echo "Make sure Git is installed and you have internet access"
    exit 1
fi

# Step 3: Install additional audio dependencies
echo ""
echo "[3/4] Installing audio processing dependencies..."
pip install librosa scipy numpy huggingface_hub
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install audio dependencies"
    exit 1
fi

# Step 4: Install server dependencies
echo ""
echo "[4/4] Installing server dependencies..."
pip install "fastapi>=0.109.0,<1.0.0" "uvicorn>=0.27.0,<1.0.0" "pydantic>=2.10.0,<3.0.0" "loguru>=0.7.2,<0.8.0" "httpx>=0.26.0,<1.0.0"
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install server dependencies"
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
echo "NOTE: The VibeVoice models will download automatically on first use:"
echo "  - VibeVoice-1.5B: ~5GB download"
echo "  - VibeVoice-7B: ~20GB download"
echo ""
echo "To test the engine server:"
echo "  venv/bin/python server.py --port 8766"
echo ""
