# Silero-VAD Audio Analysis Engine

Audio quality analysis engine using [Silero Voice Activity Detection](https://github.com/snakers4/silero-vad).

## Features

- **Speech/Silence Detection**: Accurate VAD-based speech ratio calculation
- **Silence Analysis**: Detects long silence segments that may indicate quality issues
- **Clipping Detection**: Identifies audio peaks that exceed specified thresholds
- **Volume Analysis**: Measures average audio volume in dB

## Quality Metrics

### Speech Ratio (0-100%)
- **Ideal Range**: 75-90% (configurable)
- **Warning Range**: 65-93% (configurable)
- **Critical**: Outside warning range

### Max Silence Duration
- **Warning**: >2500ms (configurable)
- **Critical**: >3750ms (configurable)

### Clipping
- **Critical**: Peak volume >0.0 dB (configurable)

### Average Volume
- **Warning**: <-40.0 dB (configurable)

## Quality Score Calculation

Score starts at 100 and subtracts points:
- **Speech ratio deviation**: up to -30 points
- **Excessive silence**: up to -30 points
- **Clipping detected**: -30 points
- **Low volume**: up to -10 points

**Status Thresholds:**
- `perfect`: 85-100
- `warning`: 70-84
- `defect`: 0-69

## Installation

```bash
# Windows
setup.bat

# Linux/Mac
chmod +x setup.sh
./setup.sh
```

## Usage

The engine runs as a FastAPI server and is managed by the backend's AudioEngineManager.

**API Endpoint:** `POST /analyze`

**Request:**
```json
{
  "audio_base64": "...",  // OR audio_path
  "audio_path": "/path/to/audio.wav",
  "quality_thresholds": {
    "speech_ratio_ideal_min": 75,
    "speech_ratio_ideal_max": 90,
    "speech_ratio_warning_min": 65,
    "speech_ratio_warning_max": 93,
    "max_silence_duration_warning": 2500,
    "max_silence_duration_critical": 3750,
    "max_clipping_peak": 0.0,
    "min_average_volume": -40.0
  }
}
```

**Response:**
```json
{
  "engine_type": "audio",
  "engine_name": "silero-vad",
  "quality_score": 85,
  "quality_status": "perfect",
  "details": {
    "top_label": "quality.audio.sileroVad",
    "fields": [
      {"key": "quality.audio.speechRatio", "value": 82, "type": "percent"},
      {"key": "quality.audio.maxSilence", "value": 1500, "type": "number"},
      {"key": "quality.audio.peakVolume", "value": "-2.3 dB", "type": "string"},
      {"key": "quality.audio.avgVolume", "value": "-35.1 dB", "type": "string"}
    ],
    "info_blocks": {
      "issues": [
        {"text": "quality.audio.speechRatioLow", "severity": "warning"}
      ]
    }
  }
}
```

## Technical Details

### Model
- **Name**: Silero VAD (version from pip package)
- **Source**: `silero-vad` pip package
- **Version Display**: Read dynamically from `silero_vad.__version__`
- **Input**: 16kHz mono audio (auto-resampled)
- **Output**: Speech timestamps with sample-level precision

### Dependencies
- Python 3.12 (specified in engine.yaml)
- silero-vad 6.0+ (VAD model and utilities)
- PyTorch 2.5+ (ML inference)
- torchaudio 2.5+ (audio processing)
- SciPy 1.14+ (audio I/O, resampling)
- NumPy 2.0+ (numerical operations)
- FastAPI 0.115+ (HTTP server)

### Versioning Decisions (as of 2025-12-04)

| Package | Version | Rationale |
|---------|---------|-----------|
| silero-vad | >=6.0.0 | Pip package with model included. Exposes `__version__` for UI display. |
| torch | >=2.5.0,<3.0.0 | Silero-VAD v6.1 confirmed PyTorch 2.9 compatibility. Minimum 2.5 for stability. |
| torchaudio | >=2.5.0,<3.0.0 | Must match torch version. |
| scipy | >=1.14.0 | Python 3.12 allows latest. No upper bound needed. |
| numpy | >=2.0.0 | NumPy 2.x for Python 3.12. Breaking changes from 1.x are minimal for this use case. |
| fastapi | >=0.115.0 | Latest stable line. |
| uvicorn | >=0.32.0 | Latest stable line. |
| pydantic | >=2.10.0,<3.0.0 | Pydantic 2.x line. |
| loguru | >=0.7.0,<1.0.0 | Stable, no breaking changes expected. |
| PyYAML | >=6.0.1 | 6.0.1 fixes LibYAML Cython build issue. |
| packaging | >=23.0 | Utility for version parsing, stable. |

### Upgrade Notes

**Python Version:**
- Engine targets Python 3.12 (specified in engine.yaml)
- Each engine has isolated venv, no cross-engine Python constraints

**Silero-VAD Package:**
- Uses pip package instead of torch.hub (cleaner dependency management)
- Version displayed in UI is read from `silero_vad.__version__`
- Model included in package (no separate download on first use)

**PyTorch CUDA:**
- PyTorch 2.5+ supports CUDA 12.6/12.8/13.0
- Silero-VAD runs on CPU (GPU not required for VAD inference)

### Performance
- **Lazy Loading**: VAD model loaded on first analysis request
- **Memory**: ~50MB (model only, excluding PyTorch overhead)
- **Speed**: ~10-50x real-time (depends on CPU/GPU)

## Configuration

All thresholds are configurable via `engine.yaml` parameters section.
Settings are exposed in the frontend Settings UI under Audio → Silero-VAD.

## Integration

This engine integrates with the Quality Worker system:
1. QualityWorker dispatches analysis jobs
2. AudioEngineManager starts this engine on-demand
3. Engine analyzes audio and returns generic quality format
4. Results stored in DB and displayed in UI

## Future Enhancements

- [ ] GPU acceleration for faster processing
- [ ] Batch analysis support for multiple segments
- [ ] Language-specific speech ratio thresholds
- [ ] Advanced metrics (SNR, THD, frequency response)
