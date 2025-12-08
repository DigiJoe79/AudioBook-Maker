#!/bin/bash
# Kani TTS Engine Setup Script (Linux/Mac)
#
# Based on: https://github.com/nineninesix-ai/kani-tts

echo "========================================"
echo "Kani TTS Engine Setup"
echo "========================================"
echo
echo "NOTE: Requires Python 3.11+ and CUDA GPU (recommended)"
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
    echo "Falling back to python3.11"
    PYTHON_VERSION="3.11"
fi

echo "Using Python $PYTHON_VERSION"
echo

echo "Creating virtual environment..."
python$PYTHON_VERSION -m venv venv
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create virtual environment"
    echo
    echo "Please ensure Python $PYTHON_VERSION is installed on your system."
    exit 1
fi

echo
echo "Activating virtual environment..."
source venv/bin/activate
python -m pip install --upgrade pip

echo
echo "========================================"
echo "Step 1: Installing PyTorch with CUDA 12.1"
echo "========================================"
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
if [ $? -ne 0 ]; then
    echo "WARNING: CUDA installation failed, trying CPU-only PyTorch..."
    pip install torch torchaudio
fi

echo
echo "========================================"
echo "Step 2: Installing core dependencies"
echo "========================================"
pip install fastapi==0.109.2 uvicorn==0.27.0 pydantic==2.6.1 loguru==0.7.2 httpx==0.26.0
pip install scipy numpy librosa soundfile huggingface_hub

echo
echo "========================================"
echo "Step 3: Installing NeMo toolkit (TTS only)"
echo "========================================"
# Use nemo_toolkit[tts] instead of [all] to avoid problematic dependencies
pip install "nemo_toolkit[tts]"

echo
echo "========================================"
echo "Step 4: Installing Transformers (custom build for LFM2)"
echo "========================================"
# Kani TTS requires a newer transformers version for lfm2 model support
pip install -U "git+https://github.com/huggingface/transformers.git"

echo
echo "========================================"
echo "Step 5: Installing kani-tts"
echo "========================================"
pip install kani-tts

if [ $? -ne 0 ]; then
    echo
    echo "========================================"
    echo "WARNING: Installation may have issues."
    echo "========================================"
    echo
    echo "If you encounter errors, check:"
    echo "- CUDA version compatibility"
    echo "- Python version (must be 3.11+)"
    echo "- Available disk space (~5GB needed)"
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
