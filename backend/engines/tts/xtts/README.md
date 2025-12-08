# XTTS v2 Engine

Text-to-Speech engine using XTTS v2 with speaker cloning capabilities.

## Features

- 17 supported languages
- Speaker voice cloning from audio samples
- Model hotswap without restart
- GPU acceleration (CUDA 11.8/12.1/12.4)

## Dependencies

### Package Migration Notice

**As of 2025-12, this engine uses `coqui-tts` instead of `TTS`.**

The original Coqui AI `TTS` package (PyPI: `TTS`) was abandoned in December 2023 after the company shutdown. The [Idiap Research Institute](https://github.com/idiap/coqui-ai-TTS) maintains an active fork published as `coqui-tts` on PyPI.

- **Old package:** `TTS==0.22.0` (abandoned, last update Dec 2023)
- **New package:** `coqui-tts>=0.27.0` (actively maintained)

The import remains unchanged (`from TTS import ...`), ensuring backward compatibility.

### Versioning Decisions (Stand: 2025-12-05)

| Package | Version | Begründung |
|---------|---------|------------|
| coqui-tts | >=0.27.0,<0.28.0 | Latest stable from maintained Idiap fork. Requires transformers >4.52.1 |
| torch | >=2.5.0,<2.6.0 | Stable release with CUDA 11.8/12.1/12.4 support. coqui-tts requires >2.1,<2.9 |
| torchaudio | >=2.5.0,<2.6.0 | Must match torch version |
| transformers | >=4.53.0,<4.56.0 | Required by coqui-tts 0.27.x (>4.52.1,<4.56). Avoid 4.50+ GenerationMixin deprecation warnings |
| fastapi | >=0.115.0,<1.0.0 | Latest stable, no breaking changes from 0.109.x |
| uvicorn | >=0.32.0,<1.0.0 | Latest stable, performance improvements |
| pydantic | >=2.10.0,<3.0.0 | Latest 2.x stable, v3 may have breaking changes |
| loguru | >=0.7.2,<0.8.0 | Stable, rarely updated |
| httpx | >=0.28.0,<1.0.0 | Latest stable async HTTP client |

### Kompatibilitätsmatrix

| coqui-tts | PyTorch | Transformers | Python | CUDA |
|-----------|---------|--------------|--------|------|
| 0.27.x | 2.2-2.8 | 4.53-4.55 | 3.10-3.13 | 11.8, 12.1, 12.4 |
| 0.26.x | 2.1-2.8 | 4.43-4.55 | 3.10-3.12 | 11.8, 12.1 |
| TTS 0.22.0 (legacy) | 2.1.x | <4.36 | 3.9-3.11 | 11.8 |

### Upstream Dependency Constraints

From `coqui-tts` 0.27.x pyproject.toml:
```
torch >2.1, <2.9
torchaudio >2.1.0, <2.9
transformers >4.52.1, <4.56
```

### Upgrade Notes

#### PyTorch Version Selection
- **2.5.x chosen** over 2.8.x for stability (2.5.1 released Nov 2025, well-tested)
- CUDA 11.8 index URL retained for maximum GPU compatibility
- For CUDA 12.x, change to `--extra-index-url https://download.pytorch.org/whl/cu121`

#### Transformers Deprecation Warning
- transformers 4.50+ deprecates `GenerationMixin` inheritance in `PreTrainedModel`
- XTTS uses `GPT2InferenceModel` which may be affected
- Monitor for warnings, may need pinning to <4.50 if issues arise

#### Known Incompatibilities
- **Python 3.14**: Not yet supported by coqui-tts
- **transformers >=4.56**: Breaks coqui-tts 0.27.x
- **torch >=2.9**: Breaks coqui-tts 0.27.x

## Installation

### Windows
```bash
cd backend/engines/tts/xtts
python -m venv venv
venv\Scripts\pip install -r requirements.txt
```

### Linux/Mac
```bash
cd backend/engines/tts/xtts
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### CPU-Only Installation
Comment out the `--extra-index-url` line in requirements.txt:
```
# --extra-index-url https://download.pytorch.org/whl/cu118
```

## Configuration

See `engine.yaml` for:
- Supported languages (17)
- Generation parameters (temperature, speed, etc.)
- Model constraints (text length limits, sample rate)

## Models

Models are auto-discovered from the `models/` directory. Each subdirectory is treated as a separate model:
```
models/
  v2.0.2/
  v2.0.3/
  custom/
```

## Troubleshooting

### CUDA Out of Memory
- Reduce batch size or use smaller model
- Ensure no other GPU processes running

### Transformers Import Errors
- Verify transformers version is within range (4.53-4.55)
- Check for conflicting installations: `pip list | grep transformers`

### Model Loading Failures
- Ensure model files are complete in models/ directory
- Check file permissions

## References

- [coqui-tts (Idiap Fork)](https://github.com/idiap/coqui-ai-TTS)
- [PyPI: coqui-tts](https://pypi.org/project/coqui-tts/)
- [PyTorch Previous Versions](https://pytorch.org/get-started/previous-versions/)
- [Original Coqui TTS (archived)](https://github.com/coqui-ai/TTS)
