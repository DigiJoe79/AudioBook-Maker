# Chatterbox Multilingual TTS Engine

High-quality multilingual text-to-speech engine with voice cloning support.

## Overview

**Chatterbox** is a state-of-the-art multilingual TTS engine developed by Resemble AI. It supports 23 languages with natural-sounding speech synthesis and voice cloning capabilities.

## Features

- ✅ **23 Languages**: Arabic, Chinese, Danish, Dutch, English, Finnish, French, German, Greek, Hebrew, Hindi, Italian, Japanese, Korean, Malay, Norwegian, Polish, Portuguese, Russian, Spanish, Swedish, Swahili, Turkish
- ✅ **Voice Cloning**: Clone any voice from a reference audio sample
- ✅ **High Quality**: 24kHz sample rate for natural-sounding speech
- ✅ **GPU Accelerated**: CUDA support for faster generation
- ✅ **Controllable**: Fine-tune exaggeration, temperature, and pacing

## Supported Languages

| Code | Language   | Code | Language   | Code | Language   |
|------|------------|------|------------|------|------------|
| ar   | Arabic     | fi   | Finnish    | ms   | Malay      |
| da   | Danish     | fr   | French     | nl   | Dutch      |
| de   | German     | he   | Hebrew     | no   | Norwegian  |
| el   | Greek      | hi   | Hindi      | pl   | Polish     |
| en   | English    | it   | Italian    | pt   | Portuguese |
| es   | Spanish    | ja   | Japanese   | ru   | Russian    |
|      |            | ko   | Korean     | sv   | Swedish    |
|      |            |      |            | sw   | Swahili    |
|      |            |      |            | tr   | Turkish    |
|      |            |      |            | zh   | Chinese    |

## Installation

### Windows

```bash
cd backend/engines/chatterbox
setup.bat
```

### Linux/Mac

```bash
cd backend/engines/chatterbox
chmod +x setup.sh
./setup.sh
```

This will:
1. Create an isolated virtual environment in `venv/`
2. Install all dependencies (PyTorch, Chatterbox, etc.)
3. Download the pretrained model automatically on first use

## System Requirements

- **Python**: 3.10-3.11 (tested with 3.11 on Debian 11)
- **RAM**: 8GB minimum, 16GB recommended
- **GPU**: Optional but recommended (CUDA 11.8/12.1/12.4 - uses PyTorch 2.6.0)
- **Storage**: ~2GB for model weights

## Dependencies

### Versioning Decisions (Stand: 2025-12-05)

| Package | Version | Begründung |
|---------|---------|------------|
| chatterbox-tts | >=0.1.4,<0.2.0 | Latest stable, pins strict internal deps |
| torch | ==2.6.0 | Pinned by chatterbox-tts (cannot override) |
| torchaudio | ==2.6.0 | Pinned by chatterbox-tts (cannot override) |
| transformers | ==4.46.3 | Pinned by chatterbox-tts (cannot override) |
| numpy | >=1.24.0,<1.26.0 | Range required by chatterbox-tts |
| fastapi | >=0.115.0,<1.0.0 | Latest stable server stack |
| uvicorn | >=0.32.0,<1.0.0 | Latest stable ASGI server |
| pydantic | >=2.10.0,<3.0.0 | Latest 2.x, v3 may break |
| scipy | >=1.11.0,<2.0.0 | Audio resampling utilities |

### Pinned Dependencies (from chatterbox-tts)

**These versions are enforced by chatterbox-tts and cannot be changed:**

| Package | Pinned Version | Notes |
|---------|---------------|-------|
| torch | 2.6.0 | CUDA 11.8/12.1/12.4 supported |
| torchaudio | 2.6.0 | Must match torch version |
| transformers | 4.46.3 | Specific HuggingFace version |
| librosa | 0.11.0 | Audio processing |
| diffusers | 0.29.0 | Diffusion model support |
| safetensors | 0.5.3 | Model serialization |
| gradio | 5.44.1 | Demo UI (not used by engine) |

### Kompatibilitätsmatrix

| chatterbox-tts | PyTorch | Transformers | Python | CUDA |
|----------------|---------|--------------|--------|------|
| 0.1.4 | 2.6.0 | 4.46.3 | 3.10-3.11 | 11.8, 12.1, 12.4 |

### Upgrade Notes

#### Why Python 3.11?
- Tested and recommended by Resemble AI
- numpy <1.26.0 constraint has better 3.11 support
- Python 3.12+ may have compatibility issues with pkuseg

#### CUDA Installation
The `setup.bat` script automatically installs PyTorch with CUDA 12.4 support.

For manual installation with GPU acceleration:
```bash
pip install --upgrade pip setuptools wheel
pip install "numpy>=1.24.0,<1.26.0" cython
pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
pip install --no-build-isolation --no-deps chatterbox-tts
pip install --no-build-isolation transformers==4.46.3 diffusers==0.29.0 librosa==0.11.0 safetensors==0.5.3 conformer==0.3.2 resemble-perth==1.0.1 s3tokenizer pykakasi==2.3.0 spacy-pkuseg
pip install fastapi uvicorn pydantic loguru httpx scipy
```

The `--no-deps` flag prevents chatterbox-tts from overwriting CUDA PyTorch with CPU-only version.

#### Known Limitations
- Cannot update PyTorch independently (pinned by upstream)
- Cannot update transformers independently (pinned by upstream)
- gradio dependency included but not used by engine server

#### pkuseg Build Issue
The `pkuseg` dependency requires numpy at build time. If you see:
```
ModuleNotFoundError: No module named 'numpy'
```

**Solution:** Install numpy first, then use `--no-build-isolation`:
```bash
pip install --upgrade pip setuptools wheel
pip install "numpy>=1.24.0,<1.26.0" cython
pip install --no-build-isolation chatterbox-tts
```

The `--no-build-isolation` flag allows pkuseg to find numpy in the current
environment instead of pip's isolated build environment.

The `setup.bat` script handles this automatically.

See: [GitHub Issue #231](https://github.com/resemble-ai/chatterbox/issues/231)

## Parameters

The following parameters can be passed via the `parameters` field in generation requests:

| Parameter     | Type  | Default | Range      | Description                                    |
|---------------|-------|---------|------------|------------------------------------------------|
| `exaggeration`| float | 0.5     | 0.25 - 2.0 | Speech expressiveness (neutral=0.5)            |
| `temperature` | float | 0.8     | 0.05 - 5.0 | Randomness in generation (higher=more varied)  |
| `cfg_weight`  | float | 0.5     | 0.0 - 1.0  | CFG/Pace weight (0=language transfer mode)     |
| `seed`        | int   | 0       | 0+         | Random seed (0=random generation)              |

### Parameter Notes

- **Exaggeration**: Controls how expressive the speech is. Values above 1.0 can sound unstable.
- **Temperature**: Higher values produce more variation but may reduce quality.
- **CFG Weight**: Set to 0 for cross-language voice transfer (e.g., English voice speaking German).
- **Seed**: Use non-zero values for reproducible results.

## Voice Cloning

Provide a reference audio file via `speaker_wav` parameter:

```python
# Single reference file
speaker_wav = "/path/to/reference.wav"

# Or list of files (first will be used)
speaker_wav = ["/path/to/reference1.wav", "/path/to/reference2.wav"]
```

**Best Practices:**
- Use 3-10 second audio clips
- Ensure reference audio matches the target language (or set `cfg_weight=0` for cross-language)
- Use high-quality, noise-free recordings
- Mono or stereo audio works

## Text Recommendations

- **Max Length**: 300 characters per generation (recommended)
- **Punctuation**: Not required but recommended for natural prosody
- **Languages**: Ensure text matches the selected language code

## Technical Details

- **Model**: Chatterbox Multilingual v0.1.4
- **Architecture**: Diffusion-based TTS with speaker conditioning
- **Sample Rate**: 24,000 Hz
- **Output Format**: WAV (PCM 16-bit)
- **License**: Apache 2.0

## Credits

Chatterbox is developed by **Resemble AI**.
GitHub: https://github.com/resemble-ai/chatterbox

## Troubleshooting

### Model Download Issues

The model downloads automatically on first use. If it fails:
- Check internet connection
- Ensure sufficient storage (~2GB)
- Try running `python -c "from chatterbox.mtl_tts import ChatterboxMultilingualTTS; ChatterboxMultilingualTTS.from_pretrained('cpu')"`

### CUDA Out of Memory

If you encounter GPU memory errors:
- Reduce text length (use shorter segments)
- Set device to CPU in backend settings
- Close other GPU applications

### Poor Quality Output

- Check that reference audio matches language (or use `cfg_weight=0`)
- Try adjusting `exaggeration` (lower for neutral, higher for expressive)
- Ensure text is properly formatted with punctuation
- Use higher-quality reference audio

## Development

### Testing Standalone

```bash
# Windows
venv\Scripts\python.exe server.py --port 8766

# Linux/Mac
venv/bin/python server.py --port 8766
```

### API Endpoints

- `POST /load` - Load model
- `POST /generate` - Generate TTS audio
- `GET /health` - Health check
- `POST /shutdown` - Graceful shutdown

See `backend/engines/base_server.py` for API documentation.

## References

- [Chatterbox GitHub](https://github.com/resemble-ai/chatterbox)
- [chatterbox-tts (PyPI)](https://pypi.org/project/chatterbox-tts/)
- [Resemble AI](https://www.resemble.ai/)
- [HuggingFace Model](https://huggingface.co/ResembleAI/chatterbox)
