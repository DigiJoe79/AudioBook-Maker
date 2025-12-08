# Whisper STT Engine

Isolated STT (Speech-to-Text) engine for audio quality analysis using OpenAI Whisper.

**Location:** `backend/engines/stt/whisper/`

## Overview

This is an STT service that provides:
- **Whisper Transcription** - Convert audio to text with word-level timestamps
- **Audio Quality Analysis** - Speech ratio, silence detection, clipping detection
- **Combined Analysis** - Single endpoint for both transcription and quality checks

**NOTE:** Unlike TTS engines, this service does NOT inherit from `BaseEngineServer` because it has custom STT-specific endpoints (`/analyze`, `/transcribe`) that don't fit the standard TTS model.

## Setup

### Windows
```bash
setup.bat
```

### Linux/Mac
```bash
chmod +x setup.sh
./setup.sh
```

This creates an isolated virtual environment in `venv/` with all Whisper dependencies.

## Manual Testing

Start the service:
```bash
# Windows
venv\Scripts\python.exe server.py --port 8767

# Linux/Mac
source venv/bin/activate
python server.py --port 8767
```

Test analysis (requires audio file as base64):
```bash
curl -X POST http://localhost:8767/analyze \
  -H "Content-Type: application/json" \
  -d '{"audioData": "<base64_encoded_wav>", "language": "de"}'
```

## API Endpoints

### Core Endpoints
- `POST /analyze` - Analyze single audio file (Whisper + Quality)
- `POST /batch-analyze` - Analyze multiple files
- `POST /load-model` - Load specific Whisper model
- `GET /health` - Service health check
- `GET /models` - List available models

### Transcription Analysis (`/analyze`)

**Request:**
```json
{
  "audioData": "base64_encoded_wav_data",
  "language": "en",
  "modelName": "base",  // optional
  "qualityThresholds": {  // optional
    "maxSilenceDurationWarning": 2500,
    "maxSilenceDurationCritical": 3750,
    "speechRatioIdealMin": 75,
    "speechRatioIdealMax": 90,
    "speechRatioWarningMin": 65,
    "speechRatioWarningMax": 93,
    "maxClippingPeak": 0.0,
    "minAverageVolume": -40.0
  }
}
```

**Response:**
```json
{
  "transcription": "Hello world",
  "confidence": 95,
  "words": [
    {"word": "Hello", "confidence": 0.98, "start": 0.0, "end": 0.5},
    {"word": "world", "confidence": 0.92, "start": 0.6, "end": 1.0}
  ],
  "language": "en",
  "duration": 1.0,
  "audioAnalyzed": true,
  "audioQualityScore": 85,
  "audioIssues": [
    {
      "type": "low_speech_ratio",
      "severity": "warning",
      "message": "",
      "details": {"speechRatio": 70, "threshold": 75}
    }
  ],
  "speechRatio": 70
}
```

## Configuration

Edit `engine.yaml` to configure:
- **Models** - Available Whisper models (tiny, base, small, medium, large)
- **Default Model** - Model loaded at startup
- **Device** - CPU/GPU selection
- **Languages** - Supported languages
- **Parameters** - Beam size, temperature, confidence threshold

## Available Models

| Model | Size | Speed | Accuracy | Use Case |
|-------|------|-------|----------|----------|
| tiny | 39 MB | ~10x realtime | Lowest | Quick testing |
| base | 74 MB | ~7x realtime | Basic | Default, balanced |
| small | 244 MB | ~4x realtime | Good | Better accuracy |
| medium | 769 MB | ~2x realtime | Better | High quality |
| large | 1550 MB | ~1x realtime | Best | Maximum accuracy |

## Audio Quality Checks

When `qualityThresholds` is provided, the service performs:

1. **Speech Detection** (Silero VAD)
   - Speech ratio (0-100%)
   - Silence duration between speech segments

2. **Clipping Detection**
   - Peak volume analysis
   - Distortion detection

3. **Volume Analysis**
   - Average RMS volume
   - Normalization recommendations

## Integration

The Whisper service is automatically discovered and managed by the main backend's STT system:
- `backend/services/stt_manager.py` - Manages service lifecycle
- `backend/core/stt_worker.py` - Consumes analysis results
- `backend/api/stt.py` - Exposes STT endpoints to frontend

## Python Version

**Required:** Python 3.12 (specified in engine.yaml)

The service uses modern Python features and PyTorch 2.x compatibility.

## Dependencies

- Python 3.12
- OpenAI Whisper v20250625+
- PyTorch 2.5+ / torchaudio 2.5+
- FastAPI 0.120+
- NumPy 2.1+
- ffmpeg (system requirement)

### Versioning Decisions (Stand: 2025-12-04)

| Package | Version | Begründung |
|---------|---------|------------|
| openai-whisper | >=20250625 | Latest stable (June 2025). Date-based versioning (YYYYMMDD). |
| torch | >=2.5.0,<3.0.0 | Range erlaubt 2.5.x-2.9.x. CUDA 11.8/12.x Support ab 2.5. |
| torchaudio | >=2.5.0,<3.0.0 | **MUSS** zu torch passen. ⚠️ 2.9: Maintenance-Mode, deprecated APIs entfernt. |
| numpy | >=2.1.0 | 2.1+ für Python 3.12 Verbesserungen. Latest: 2.3.5 (Nov 2025). |
| fastapi | >=0.120.0 | Pydantic 2.12 Kompatibilität. Latest: 0.123.0 (Nov 2025). |
| uvicorn | >=0.34.0 | Python 3.13/3.14 Support. Latest: 0.38.0 (Oct 2025). |
| pydantic | >=2.10.0,<3.0.0 | Pydantic 2.x line. Latest: 2.12.5 (Nov 2025). |
| pydub | >=0.25.1 | Keine Updates seit März 2021 - Projekt stabil aber inaktiv. |
| loguru | >=0.7.0,<1.0.0 | Latest: 0.7.3 (2025). Keine Breaking Changes erwartet. |
| pyyaml | >=6.0.1 | 6.0.1 behebt LibYAML Cython Build-Problem. |

### Upgrade Notes

**OpenAI Whisper:**
- GitHub: https://github.com/openai/whisper
- Uses date-based versioning (YYYYMMDD) - check releases for new versions
- Models download automatically on first use via torch.hub
- Requires ffmpeg installed on system
- Previous release was v20240930 (September 2024)

**PyTorch / torchaudio:**
- **KRITISCH:** torch und torchaudio Versionen müssen identisch sein!
- PyTorch 2.9.1 (Nov 2025) ist aktuell, aber torchaudio 2.9 hat Breaking Changes
- torchaudio 2.9 ist im Maintenance-Mode - deprecated APIs wurden entfernt
- Empfehlung: Bei Problemen auf 2.8.x downgraden: `pip install torch==2.8.0 torchaudio==2.8.0`
- CUDA: 2.5+ unterstützt CUDA 11.8 und 12.x
- Set device to "cuda" in engine.yaml for GPU acceleration

**NumPy:**
- NumPy 2.x hat Breaking Changes gegenüber 1.x (C-API, Deprecations)
- 2.1+ empfohlen für Python 3.12

### Tested Configuration

Diese Konfiguration wurde getestet und funktioniert:
```
openai-whisper==20250625
torch==2.5.1
torchaudio==2.5.1
numpy==2.1.3
fastapi==0.115.6
uvicorn==0.34.0
pydantic==2.10.4
```

### Breaking Changes Watch

| Package | Version | Änderung |
|---------|---------|----------|
| torchaudio | 2.9.0 | Maintenance-Mode, `torchaudio.load()`/`save()` nutzen jetzt TorchCodec |
| numpy | 2.0.0 | C-API Änderungen, einige deprecated Funktionen entfernt |
| pydantic | 3.0.0 | Noch nicht released, aber Pydantic v1 Support entfernt in naher Zukunft |
