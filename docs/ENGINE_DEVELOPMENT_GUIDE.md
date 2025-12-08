# Engine Development Guide

**How to add custom engines to Audiobook Maker**

## Table of Contents

1. [Overview](#overview)
2. [Architecture Concept](#architecture-concept)
3. [Quick Start](#quick-start)
4. [Implementation Guide](#implementation-guide)
5. [Configuration Reference](#configuration-reference)
6. [Testing Your Engine](#testing-your-engine)
7. [Best Practices](#best-practices)
8. [Examples](#examples)
9. [Troubleshooting](#troubleshooting)

---

## Overview

Audiobook Maker v1.0.0+ features a **multi-engine architecture** with 4 engine types that allows developers to add custom engines without modifying the backend code. Each engine:

- Runs as a **separate FastAPI server** in its own process
- Has its own **isolated virtual environment** (no dependency conflicts)
- Is **auto-discovered** by the backend on startup
- Gets **automatic HTTP API** endpoints from base server classes
- Stays **"warm"** between requests (models loaded in memory)
- Can **crash independently** without affecting the backend
- Supports **enable/disable** with automatic **auto-stop** after inactivity

### Engine Types

| Type | Purpose | Base Class | Endpoint |
|------|---------|------------|----------|
| **TTS** | Text-to-Speech synthesis | `BaseTTSServer` | `/generate` |
| **STT** | Speech-to-Text transcription | `BaseQualityServer` | `/analyze` |
| **Text Processing** | Text segmentation (spaCy) | `BaseTextServer` | `/segment` |
| **Audio Analysis** | Audio quality analysis (VAD) | `BaseQualityServer` | `/analyze` |

### What You Need to Provide

Only **3-4 methods** and **1 config file**:

**For TTS Engines:**
```python
def load_model(self, model_name: str) -> None:
    """Load your TTS model into memory"""

def generate_audio(self, text, language, speaker_wav, parameters) -> bytes:
    """Generate audio and return WAV bytes"""

def unload_model(self) -> None:
    """Free resources"""

def get_available_models(self) -> List[ModelInfo]:
    """Return list of available models"""
```

**For STT/Audio Engines:**
```python
def load_model(self, model_name: str) -> None:
    """Load your analysis model into memory"""

def analyze_audio(self, audio_path, reference_text, parameters) -> AnalysisResult:
    """Analyze audio and return quality metrics"""

def unload_model(self) -> None:
    """Free resources"""

def get_available_models(self) -> List[ModelInfo]:
    """Return list of available models"""
```

Everything else (HTTP server, error handling, logging, health checks) is provided by the base server classes.

---

## Architecture Concept

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  Backend (Main FastAPI, Port 8765)                              │
│  - Engine Discovery (scans backend/engines/{type}/)             │
│  - 4 Engine Managers (TTS, STT, Text, Audio)                    │
│  - Workers (TTS Worker, Quality Worker)                         │
│  - Activity Tracking & Auto-Stop (5 min)                        │
└────────────┬────────────────────────────────────────────────────┘
             │
             │ HTTP Requests (localhost)
             │
    ┌────────┴────────┬─────────────┬─────────────┬─────────────┐
    │                 │             │             │             │
    ▼                 ▼             ▼             ▼             ▼
┌────────────┐  ┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ TTS        │  │ TTS         │ │ STT      │ │ Text     │ │ Audio    │
│ XTTS       │  │ Chatterbox  │ │ Whisper  │ │ spaCy    │ │ Silero   │
│ Port 8766  │  │ Port 8767   │ │ Port 8770│ │ Port 8772│ │ Port 8774│
│ (VENV 1)   │  │ (VENV 2)    │ │ (VENV 3) │ │ (VENV 4) │ │ (VENV 5) │
└────────────┘  └─────────────┘ └──────────┘ └──────────┘ └──────────┘
```

**Key Benefits:**

1. **Dependency Isolation** - XTTS needs PyTorch 2.5, Whisper needs 2.9? No problem!
2. **Version Conflicts** - Different Python versions, CUDA versions, etc.
3. **Crash Isolation** - Engine crash? Backend keeps running, just restart the engine
4. **Hot Swapping** - Switch between engines without backend restart
5. **Development** - Develop and test engines independently
6. **Auto-Stop** - Non-default engines stop after 5 minutes of inactivity

### Engine Lifecycle

```
1. Backend Startup
   ↓
2. Engine Discovery (scan backend/engines/{type}/)
   ↓
3. Parse engine.yaml
   ↓
4. Check enabled status (settings DB)
   ↓
5. Start engine subprocess (venv/python server.py --port XXXX)
   ↓
6. Health check (wait for /health to return 200)
   ↓
7. Register engine in EngineManager
   ↓
8. User selects engine in UI
   ↓
9. Backend sends /load request (load model)
   ↓
10. Backend sends /generate or /analyze requests
    ↓
11. Activity tracking (record last use timestamp)
    ↓
12. Auto-stop after 5 min inactivity (non-default engines)
    ↓
13. Backend sends /shutdown on exit (graceful shutdown)
```

### Engine Status Lifecycle

```
disabled → stopped → starting → running → stopping → stopped
    ↑                                                   │
    └───────────────────────────────────────────────────┘
```

- **disabled**: Engine is disabled in settings, won't start
- **stopped**: Engine is enabled but not running
- **starting**: Engine process is launching
- **running**: Engine is healthy and accepting requests
- **stopping**: Engine is shutting down gracefully

---

## Quick Start

### Step 1: Choose Engine Type

Decide which type of engine you're creating:
- **TTS**: Text-to-Speech synthesis → `backend/engines/tts/`
- **STT**: Speech-to-Text analysis → `backend/engines/stt/`
- **Text**: Text processing → `backend/engines/text_processing/`
- **Audio**: Audio analysis → `backend/engines/audio_analysis/`

### Step 2: Copy Template

```bash
cd backend/engines/{type}
cp -r _template my_engine
cd my_engine
```

### Step 3: Customize `engine.yaml`

```yaml
name: "my_engine"
display_name: "My Custom Engine"
version: "1.0.0"
type: "tts"  # or "stt", "text_processing", "audio_analysis"
python_version: "3.10"
venv_path: "./venv"

capabilities:
  supports_model_hotswap: true
  supports_speaker_cloning: true  # TTS only
  supports_streaming: false

constraints:
  min_text_length: 10
  max_text_length: 500
  sample_rate: 24000
  audio_format: "wav"

supported_languages:
  - en
  - de
  - fr
```

### Step 4: Edit `requirements.txt`

```txt
# Base requirements (always needed)
-e ../../..  # Installs backend core (BaseEngineServer, utilities)

# Your engine dependencies
torch>=2.0.0
torchaudio>=2.0.0
numpy>=1.24.0
# ... add your engine library here
```

### Step 5: Implement `server.py`

**For TTS Engine:**
```python
from pathlib import Path
from typing import Dict, Any, Union, List
import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from engines.base_tts_server import BaseTTSServer
from engines.base_server import ModelInfo

class MyTTSServer(BaseTTSServer):
    """My Custom TTS Engine"""

    def __init__(self):
        super().__init__(
            engine_name="my_engine",
            display_name="My Custom TTS"
        )
        self.model = None

    def load_model(self, model_name: str) -> None:
        """Load your TTS model"""
        model_path = Path(__file__).parent / "models" / model_name
        # TODO: Load your model
        # self.model = YourTTSClass.from_pretrained(model_path)
        self.logger.info(f"Loaded model: {model_name}")

    def generate_audio(
        self,
        text: str,
        language: str,
        speaker_wav: Union[str, List[str]],
        parameters: Dict[str, Any]
    ) -> bytes:
        """Generate TTS audio"""
        # TODO: Generate audio with your model
        # audio_array = self.model.synthesize(text, language=language)

        # Convert to WAV bytes
        import io
        import torchaudio

        buffer = io.BytesIO()
        torchaudio.save(buffer, audio_array, sample_rate=24000, format="wav")
        return buffer.getvalue()

    def unload_model(self) -> None:
        """Free resources"""
        self.model = None
        self.logger.info("Unloaded model")

    def get_available_models(self) -> List[ModelInfo]:
        """Return list of available models"""
        models_dir = Path(__file__).parent / "models"
        models = []
        if models_dir.exists():
            for model_dir in models_dir.iterdir():
                if model_dir.is_dir():
                    models.append(ModelInfo(
                        name=model_dir.name,
                        display_name=model_dir.name.replace("_", " ").title()
                    ))
        return models


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    server = MyTTSServer()
    server.run(port=args.port, host=args.host)
```

**For STT/Audio Engine:**
```python
from pathlib import Path
from typing import Dict, Any, List
import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from engines.base_quality_server import BaseQualityServer, AnalysisResult
from engines.base_server import ModelInfo

class MySTTServer(BaseQualityServer):
    """My Custom STT Engine"""

    def __init__(self):
        super().__init__(
            engine_name="my_stt",
            display_name="My Custom STT"
        )
        self.model = None

    def load_model(self, model_name: str) -> None:
        """Load your STT model"""
        # TODO: Load your model
        self.logger.info(f"Loaded model: {model_name}")

    def analyze_audio(
        self,
        audio_path: str,
        reference_text: str,
        parameters: Dict[str, Any]
    ) -> AnalysisResult:
        """Analyze audio quality"""
        # TODO: Analyze audio with your model
        # transcription = self.model.transcribe(audio_path)

        return AnalysisResult(
            quality_score=85.0,
            quality_status="perfect",  # "perfect", "warning", "defect"
            details={
                "fields": [
                    {"label": "Transcription", "value": "..."},
                    {"label": "Confidence", "value": "85%"}
                ],
                "infoBlocks": []
            }
        )

    def unload_model(self) -> None:
        """Free resources"""
        self.model = None
        self.logger.info("Unloaded model")

    def get_available_models(self) -> List[ModelInfo]:
        """Return list of available models"""
        return [
            ModelInfo(name="base", display_name="Base Model"),
            ModelInfo(name="large", display_name="Large Model")
        ]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    server = MySTTServer()
    server.run(port=args.port, host=args.host)
```

### Step 6: Create Virtual Environment

**Windows:**
```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

**Linux/Mac:**
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Step 7: Test Standalone (Optional)

```bash
# Start engine server
venv\Scripts\python server.py --port 8766

# In another terminal:
curl http://localhost:8766/health
# Should return: {"status":"ready","ttsModelLoaded":false}

curl http://localhost:8766/models
# Should return: [{"name":"default","displayName":"Default"}]
```

### Step 8: Restart Backend

```bash
cd ../../..
venv\Scripts\python main.py
```

**Your engine should now appear in the UI!**

---

## Implementation Guide

### Base Server Classes

The engine system uses a hierarchy of base classes:

```
BaseEngineServer (Generic)
├── BaseTTSServer (TTS-specific, adds /generate)
├── BaseQualityServer (STT + Audio, adds /analyze)
└── BaseTextServer (Text Processing, adds /segment)
```

### Required Methods by Engine Type

#### TTS Engines (inherit `BaseTTSServer`)

| Method | Purpose |
|--------|---------|
| `load_model(model_name)` | Load TTS model into memory |
| `generate_audio(text, language, speaker_wav, parameters)` | Synthesize text to WAV bytes |
| `unload_model()` | Free GPU/RAM resources |
| `get_available_models()` | Return list of `ModelInfo` objects |

#### STT/Audio Engines (inherit `BaseQualityServer`)

| Method | Purpose |
|--------|---------|
| `load_model(model_name)` | Load analysis model into memory |
| `analyze_audio(audio_path, reference_text, parameters)` | Return `AnalysisResult` |
| `unload_model()` | Free GPU/RAM resources |
| `get_available_models()` | Return list of `ModelInfo` objects |

#### Text Processing Engines (inherit `BaseTextServer`)

| Method | Purpose |
|--------|---------|
| `load_model(model_name)` | Load NLP model into memory |
| `segment_text(text, language, parameters)` | Return list of text segments |
| `unload_model()` | Free resources |
| `get_available_models()` | Return list of `ModelInfo` objects |

### ModelInfo Structure

```python
from dataclasses import dataclass

@dataclass
class ModelInfo:
    name: str           # Internal name (used in API calls)
    display_name: str   # UI display name
    description: str = ""
    size_mb: int = 0
    languages: List[str] = None
```

### AnalysisResult Structure (STT/Audio)

```python
@dataclass
class AnalysisResult:
    quality_score: float      # 0-100
    quality_status: str       # "perfect", "warning", "defect"
    details: Dict[str, Any]   # Engine-specific details
```

**Details Format:**
```python
{
    "fields": [
        {"label": "Transcription", "value": "Hello world"},
        {"label": "Confidence", "value": "92%"}
    ],
    "infoBlocks": [
        {
            "title": "Issues Found",
            "items": ["Missing word: 'the'", "Low confidence at 0:05"]
        }
    ]
}
```

---

## Configuration Reference

### `engine.yaml` Structure

```yaml
# Engine Identification
name: "my_engine"              # Internal name (lowercase, no spaces)
display_name: "My TTS Engine"  # UI display name
version: "1.0.0"               # Your engine version
type: "tts"                    # Engine type: tts, stt, text_processing, audio_analysis

# Python Requirements
python_version: "3.10"         # Required Python version

# Virtual Environment
venv_path: "./venv"            # Path to VENV (relative to engine.yaml)

# Capabilities (what your engine can do)
capabilities:
  supports_model_hotswap: true    # Can switch models without restart
  supports_speaker_cloning: true  # Supports voice cloning (TTS only)
  supports_streaming: false       # Supports streaming (future)

# Constraints (technical limits)
constraints:
  min_text_length: 10          # Minimum text length (characters)
  max_text_length: 500         # Maximum text length (characters)
  sample_rate: 24000           # Output sample rate (Hz)
  audio_format: "wav"          # Output format (always "wav")
  requires_punctuation: true   # Requires proper punctuation

# Models (auto-discovered from models/ directory)
# Each subdirectory in models/ becomes a model option
# Example: models/default/, models/v1.0/, models/custom/

# Supported Languages (ISO 639-1 codes)
supported_languages:
  - en  # English
  - de  # German
  - fr  # French
  - es  # Spanish
  - it  # Italian
  - pt  # Portuguese
  # ... add your supported languages
```

### Language Codes (ISO 639-1)

Common codes:
- `en` - English
- `de` - German (Deutsch)
- `fr` - French
- `es` - Spanish
- `it` - Italian
- `pt` - Portuguese
- `nl` - Dutch
- `pl` - Polish
- `ru` - Russian
- `zh` - Chinese
- `ja` - Japanese
- `ko` - Korean
- `ar` - Arabic
- `hi` - Hindi
- `tr` - Turkish

---

## Testing Your Engine

### 1. Standalone Testing

Test your engine independently before integrating:

```bash
# Start engine server
cd backend/engines/{type}/my_engine
venv\Scripts\python server.py --port 8766

# Test health check
curl http://localhost:8766/health
# Response: {"status":"ready","ttsModelLoaded":false}

# Test available models
curl http://localhost:8766/models
# Response: [{"name":"default","displayName":"Default"}]

# Test load model
curl -X POST http://localhost:8766/load \
  -H "Content-Type: application/json" \
  -d '{"ttsModelName":"default"}'
# Response: {"status":"loaded","ttsModelName":"default"}

# Test generate audio (TTS)
curl -X POST http://localhost:8766/generate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello world, this is a test.",
    "language": "en",
    "ttsSpeakerWav": "",
    "parameters": {}
  }' \
  --output test.wav

# Test analyze audio (STT/Audio)
curl -X POST http://localhost:8766/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "audioPath": "/path/to/audio.wav",
    "referenceText": "Hello world",
    "parameters": {}
  }'
```

### 2. Integration Testing

Start the full backend:

```bash
cd backend
venv\Scripts\python main.py
```

**Check logs for:**
- Engine discovery: `Discovered engine: my_engine (type: tts)`
- Engine startup: `Starting engine server: my_engine on port 8766`
- Health check: `Engine my_engine is healthy`

**In UI:**
1. Open Audiobook Maker
2. Go to Settings → TTS (or relevant tab)
3. Check if your engine appears in the dropdown
4. Select your engine
5. Test generation/analysis

---

## Examples

### Example 1: Cloud API Engine (OpenAI TTS)

For engines that call external APIs:

```python
import httpx
import os

class OpenAITTSServer(BaseTTSServer):
    def __init__(self):
        super().__init__(engine_name="openai_tts", display_name="OpenAI TTS")

    def load_model(self, model_name: str) -> None:
        self.current_model = model_name
        self.logger.info(f"Using OpenAI model: {model_name}")

    def generate_audio(self, text, language, speaker_wav, parameters):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not set")

        response = httpx.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": self.current_model or "tts-1",
                "input": text,
                "voice": parameters.get("voice", "alloy")
            }
        )

        if response.status_code != 200:
            raise RuntimeError(f"API error: {response.text}")

        # OpenAI returns MP3, convert to WAV
        return self._convert_mp3_to_wav(response.content)

    def unload_model(self) -> None:
        self.current_model = None

    def get_available_models(self):
        return [
            ModelInfo(name="tts-1", display_name="TTS-1 (Fast)"),
            ModelInfo(name="tts-1-hd", display_name="TTS-1 HD (Quality)")
        ]
```

### Example 2: Multi-Speaker Engine (Piper)

For engines with built-in speaker voices:

```python
class PiperTTSServer(BaseTTSServer):
    def __init__(self):
        super().__init__(engine_name="piper", display_name="Piper TTS")
        self.voices = {}

    def load_model(self, model_name: str) -> None:
        model_path = Path(__file__).parent / "models" / model_name
        self.model = PiperVoice.load(model_path)
        self.current_model = model_name

    def generate_audio(self, text, language, speaker_wav, parameters):
        # Ignore speaker_wav (Piper uses built-in voices)
        speaker_id = parameters.get("speaker_id", 0)

        audio = self.model.synthesize(
            text=text,
            speaker_id=speaker_id,
            length_scale=parameters.get("speed", 1.0)
        )

        return self._to_wav_bytes(audio)

    def get_available_models(self):
        models_dir = Path(__file__).parent / "models"
        return [
            ModelInfo(name=d.name, display_name=d.name.replace("-", " ").title())
            for d in models_dir.iterdir() if d.is_dir()
        ]
```

### Example 3: Audio Quality Analyzer

```python
class AudioQualityServer(BaseQualityServer):
    def __init__(self):
        super().__init__(engine_name="audio_quality", display_name="Audio Quality")

    def load_model(self, model_name: str) -> None:
        self.vad_model = load_silero_vad()
        self.logger.info("Loaded VAD model")

    def analyze_audio(self, audio_path, reference_text, parameters):
        # Analyze audio characteristics
        audio, sr = torchaudio.load(audio_path)

        # Get speech timestamps
        speech_timestamps = self.vad_model(audio, sr)

        # Calculate metrics
        total_duration = audio.shape[1] / sr
        speech_duration = sum(t['end'] - t['start'] for t in speech_timestamps)
        speech_ratio = speech_duration / total_duration

        # Detect issues
        issues = []
        if speech_ratio < 0.5:
            issues.append("Low speech ratio - too much silence")

        # Calculate quality score
        quality_score = min(100, speech_ratio * 100 + 20)
        quality_status = "perfect" if quality_score >= 85 else "warning" if quality_score >= 70 else "defect"

        return AnalysisResult(
            quality_score=quality_score,
            quality_status=quality_status,
            details={
                "fields": [
                    {"label": "Speech Ratio", "value": f"{speech_ratio*100:.1f}%"},
                    {"label": "Duration", "value": f"{total_duration:.1f}s"}
                ],
                "infoBlocks": [
                    {"title": "Issues", "items": issues}
                ] if issues else []
            }
        )
```

---

## Best Practices

### Memory Management

```python
def unload_model(self) -> None:
    if self.model is not None:
        # Free GPU memory
        if hasattr(self.model, 'to'):
            self.model.to('cpu')

        del self.model
        self.model = None

        # Clear CUDA cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        self.logger.info("Unloaded model")
```

### Error Handling

```python
def generate_audio(self, text, language, speaker_wav, parameters):
    if self.model is None:
        raise RuntimeError("Model not loaded")

    if not text or len(text.strip()) == 0:
        raise ValueError("Text is empty")

    if language not in self.supported_languages:
        raise ValueError(f"Unsupported language: {language}")

    try:
        audio = self.model.synthesize(text)
        return self._to_wav_bytes(audio)
    except Exception as e:
        self.logger.error(f"Generation failed: {e}")
        raise RuntimeError(f"Audio generation failed: {e}")
```

### Logging

```python
# Use the built-in logger
self.logger.info(f"Loading model: {model_name}")
self.logger.debug(f"Parameters: {parameters}")
self.logger.warning(f"Slow generation: {elapsed}s")
self.logger.error(f"Generation failed: {e}")
```

---

## Troubleshooting

### Engine Not Appearing in UI

**Check:**
1. `engine.yaml` exists and is valid YAML
2. `type` field matches directory (`tts`, `stt`, `text_processing`, `audio_analysis`)
3. `server.py` is executable
4. VENV is created (`venv/` directory exists)
5. VENV has dependencies installed
6. Backend logs show `Discovered engine: my_engine`

**Debug:**
```bash
# Test YAML parsing
python -c "import yaml; print(yaml.safe_load(open('engine.yaml')))"

# Test server startup manually
venv\Scripts\python server.py --port 8766
```

### Engine Disabled

**Check:**
1. Engine is enabled in Settings
2. Check logs for `Engine my_engine is disabled`

**Fix:**
- Go to Settings → [Engine Type] → Enable your engine
- Or use API: `POST /api/engines/{type}/{name}/enable`

### Engine Starts But Health Check Fails

**Check:**
1. Server starts without errors
2. Port is not already in use
3. `/health` endpoint returns 200
4. No firewall blocking localhost

**Debug:**
```bash
# Check if port is available
netstat -an | findstr 8766

# Test health endpoint
curl http://localhost:8766/health
```

### Generation Fails

**Check:**
1. Model is loaded (`/load` was called successfully)
2. Text length is within constraints
3. Language is supported
4. Speaker sample exists (if cloning)

**Debug:**
```python
# Add debug logging
self.logger.debug(f"Generating audio for: {text[:50]}...")
self.logger.debug(f"Language: {language}, Speaker: {speaker_wav}")
```

### Memory Issues

**Solutions:**
- Use smaller models
- Implement model offloading (CPU <-> GPU)
- Process text in smaller chunks
- Clear cache in `unload_model()`
- Enable auto-stop for non-essential engines

---

## Available Engines

### TTS Engines

| Engine | Languages | Key Features |
|--------|-----------|--------------|
| **XTTS v2** | 17 | Speaker cloning, model hotswap, coqui-tts 0.27 |
| **Chatterbox** | 23 | Speaker cloning, Python 3.11, PyTorch 2.6 |

### STT Engines

| Engine | Languages | Key Features |
|--------|-----------|--------------|
| **Whisper** | 12 | 5 model sizes (tiny-large), Python 3.12 |

### Text Processing Engines

| Engine | Languages | Key Features |
|--------|-----------|--------------|
| **spaCy** | 11 | MD models only, CPU-only |

### Audio Analysis Engines

| Engine | Key Features |
|--------|--------------|
| **Silero-VAD** | Speech/silence detection, clipping, volume analysis |

---

## Reference: XTTS Engine

The XTTS engine is a complete working example:

**Location:** `backend/engines/tts/xtts/`

**Features:**
- Voice cloning from audio samples
- 17+ languages
- GPU acceleration (CUDA)
- Model hotswapping (v2.0.2 <-> v2.0.3)

**Study files:**
- `server.py` - Complete implementation
- `engine.yaml` - Configuration example
- `requirements.txt` - Dependencies with CUDA

---

## Contributing Engines

Want to contribute your engine to the official repository?

1. **Ensure quality:**
   - Complete documentation
   - Unit tests
   - Error handling
   - Logging

2. **Create PR:**
   - Fork repository
   - Add engine to `backend/engines/{type}/`
   - Update `README.md`
   - Submit pull request

3. **Checklist:**
   - [ ] Inherits correct base class
   - [ ] Implements all required methods
   - [ ] Has `engine.yaml` with all fields
   - [ ] Has `requirements.txt`
   - [ ] Has `README.md`
   - [ ] Works on Windows + Linux
   - [ ] Passes standalone tests

---

**Happy Engine Building!**
