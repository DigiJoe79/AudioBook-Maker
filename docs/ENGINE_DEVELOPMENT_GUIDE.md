# Engine Development Guide

**How to add custom TTS engines to Audiobook Maker**

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

Audiobook Maker v0.2.0+ features a **plug-and-play engine system** that allows developers to add custom TTS engines without modifying the backend code. Each engine:

- ✅ Runs as a **separate FastAPI server** in its own process
- ✅ Has its own **isolated virtual environment** (no dependency conflicts)
- ✅ Is **auto-discovered** by the backend on startup
- ✅ Gets **automatic HTTP API** endpoints from `BaseEngineServer`
- ✅ Stays **"warm"** between requests (models loaded in memory)
- ✅ Can **crash independently** without affecting the backend

### What You Need to Provide

Only **3 methods** and **1 config file**:

```python
def load_model(self, model_name: str) -> None:
    """Load your TTS model into memory"""

def generate_audio(self, text, language, speaker_wav, parameters) -> bytes:
    """Generate audio and return WAV bytes"""

def unload_model(self) -> None:
    """Free resources"""
```

Everything else (HTTP server, error handling, logging, health checks) is provided by `BaseEngineServer`.

---

## Architecture Concept

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│  Backend (Main FastAPI, Port 8765)                      │
│  - Engine Discovery (scans backend/engines/)            │
│  - Engine Manager (starts/stops engine servers)         │
│  - TTS Worker (communicates with engines via HTTP)      │
└────────────┬────────────────────────────────────────────┘
             │
             │ HTTP Requests (localhost)
             │
    ┌────────┴────────┬─────────────┬─────────────┐
    │                 │             │             │
    ▼                 ▼             ▼             ▼
┌────────────┐  ┌─────────────┐ ┌──────────┐ ┌──────────┐
│ XTTS       │  │ Chatterbox  │ │ Piper    │ │ OpenAI   │
│ Port 8766  │  │ Port 8767   │ │ Port 8768│ │ Port 8769│
│ (VENV 1)   │  │ (VENV 2)    │ │ (VENV 3) │ │ (VENV 4) │
└────────────┘  └─────────────┘ └──────────┘ └──────────┘
```

**Key Benefits:**

1. **Dependency Isolation** - XTTS needs PyTorch 2.1, Chatterbox needs PyTorch 2.4? No problem!
2. **Version Conflicts** - Different Python versions, CUDA versions, etc.
3. **Crash Isolation** - Engine crash? Backend keeps running, just restart the engine
4. **Hot Swapping** - Switch between engines without backend restart
5. **Development** - Develop and test engines independently

### Engine Lifecycle

```
1. Backend Startup
   ↓
2. Engine Discovery (scan backend/engines/)
   ↓
3. Parse engine.yaml
   ↓
4. Start engine subprocess (venv/python server.py --port XXXX)
   ↓
5. Health check (wait for /health to return 200)
   ↓
6. Register engine in EngineManager
   ↓
7. User selects engine in UI
   ↓
8. Backend sends /load request (load model)
   ↓
9. Backend sends /generate requests (TTS generation)
   ↓
10. Backend sends /shutdown on exit (graceful shutdown)
```

---

## Quick Start

### Step 1: Copy Template

```bash
cd backend/engines
cp -r _template my_engine
cd my_engine
```

### Step 2: Customize `engine.yaml`

```yaml
name: "my_engine"
display_name: "My Custom TTS"
version: "1.0.0"
python_version: "3.10"
venv_path: "./venv"

capabilities:
  supports_model_hotswap: true
  supports_speaker_cloning: true
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

### Step 3: Edit `requirements.txt`

```txt
# Base requirements (always needed)
-e ../../  # Installs backend core (BaseEngineServer, utilities)

# Your engine dependencies
torch>=2.0.0
torchaudio>=2.0.0
numpy>=1.24.0
# ... add your TTS library here
```

### Step 4: Implement `server.py`

```python
from pathlib import Path
from typing import Dict, Any, Union, List
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from base_server import BaseEngineServer

class MyEngineServer(BaseEngineServer):
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


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    server = MyEngineServer()
    server.run(port=args.port, host=args.host)
```

### Step 5: Create Virtual Environment

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

### Step 6: Test Standalone (Optional)

```bash
# Start engine server
venv\Scripts\python server.py --port 8766

# In another terminal:
curl http://localhost:8766/health
# Should return: {"status":"ready","ttsModelLoaded":false}
```

### Step 7: Restart Backend

```bash
cd ../../..
venv\Scripts\python main.py
```

**Your engine should now appear in the UI!** 🎉

---

## Implementation Guide

### The 3 Required Methods

#### 1. `load_model(model_name: str)`

**Purpose:** Load a TTS model into memory.

**When Called:**
- When backend starts (if this is the preferred engine)
- When user switches to this engine
- When user switches between models

**What to Do:**
```python
def load_model(self, model_name: str) -> None:
    # 1. Construct model path
    model_path = Path(__file__).parent / "models" / model_name

    # 2. Check if model exists
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    # 3. Unload previous model (if any)
    if self.model is not None:
        self.unload_model()

    # 4. Load new model
    self.model = YourTTSClass.load(model_path)

    # 5. Set current model name
    self.current_model = model_name

    self.logger.info(f"Loaded model: {model_name}")
```

**Error Handling:**
- Raise `FileNotFoundError` if model doesn't exist
- Raise `RuntimeError` if loading fails
- All exceptions are caught by `BaseEngineServer` and returned as HTTP 500

#### 2. `generate_audio(text, language, speaker_wav, parameters)`

**Purpose:** Synthesize text to audio.

**Parameters:**
- `text` (str): Text to synthesize
- `language` (str): Language code (e.g., "en", "de", "fr")
- `speaker_wav` (str or List[str]): Path(s) to speaker sample(s)
  - For voice cloning: speaker sample file path(s)
  - For non-cloning engines: empty string or None
- `parameters` (dict): Engine-specific parameters (from UI)

**Return:** WAV audio as bytes

**What to Do:**
```python
def generate_audio(
    self,
    text: str,
    language: str,
    speaker_wav: Union[str, List[str]],
    parameters: Dict[str, Any]
) -> bytes:
    # 1. Check if model is loaded
    if self.model is None:
        raise RuntimeError("Model not loaded")

    # 2. Validate inputs
    if not text or len(text.strip()) == 0:
        raise ValueError("Text is empty")

    # 3. Generate audio (your TTS logic)
    audio_array = self.model.synthesize(
        text=text,
        language=language,
        speaker_wav=speaker_wav,
        **parameters
    )

    # 4. Convert to WAV bytes
    import io
    import torchaudio

    buffer = io.BytesIO()
    torchaudio.save(
        buffer,
        audio_array,
        sample_rate=self.config.constraints.sample_rate,
        format="wav"
    )

    return buffer.getvalue()
```

**Audio Format Requirements:**
- Must return **WAV format** bytes
- Sample rate should match `engine.yaml` (`constraints.sample_rate`)
- Mono or stereo (mono preferred for speech)

**Error Handling:**
- Raise `ValueError` for invalid inputs
- Raise `RuntimeError` for generation errors
- All exceptions are caught by `BaseEngineServer`

#### 3. `unload_model()`

**Purpose:** Free resources (GPU memory, RAM, etc.).

**When Called:**
- When switching to another engine
- When switching between models (before loading new one)
- When backend shuts down

**What to Do:**
```python
def unload_model(self) -> None:
    if self.model is not None:
        # Free GPU memory
        if hasattr(self.model, 'to'):
            self.model.to('cpu')

        del self.model
        self.model = None

        # Optional: Clear CUDA cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        self.logger.info("Unloaded model")
```

---

## Configuration Reference

### `engine.yaml` Structure

```yaml
# Engine Identification
name: "my_engine"              # Internal name (lowercase, no spaces)
display_name: "My TTS Engine"  # UI display name
version: "1.0.0"               # Your engine version

# Python Requirements
python_version: "3.10"         # Required Python version

# Virtual Environment
venv_path: "./venv"            # Path to VENV (relative to engine.yaml)

# Capabilities (what your engine can do)
capabilities:
  supports_model_hotswap: true    # Can switch models without restart
  supports_speaker_cloning: true  # Supports voice cloning
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
cd backend/engines/my_engine
venv\Scripts\python server.py --port 8766

# Test health check
curl http://localhost:8766/health
# Response: {"status":"ready","ttsModelLoaded":false}

# Test load model
curl -X POST http://localhost:8766/load \
  -H "Content-Type: application/json" \
  -d '{"ttsModelName":"default"}'
# Response: {"status":"loaded","ttsModelName":"default"}

# Test generate audio
curl -X POST http://localhost:8766/generate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello world, this is a test.",
    "language": "en",
    "ttsSpeakerWav": "",
    "parameters": {}
  }' \
  --output test.wav

# Play audio
# Windows: start test.wav
# Linux: aplay test.wav
# Mac: afplay test.wav
```

### 2. Integration Testing

Start the full backend:

```bash
cd backend
venv\Scripts\python main.py
```

**Check logs for:**
- Engine discovery: `Discovered engine: my_engine`
- Engine startup: `Starting engine server: my_engine on port 8766`
- Health check: `Engine my_engine is healthy`

**In UI:**
1. Open Audiobook Maker
2. Check if your engine appears in the TTS Engine dropdown
3. Select your engine
4. Create a test segment
5. Click "Generate Audio"

---

## Examples

### Example 1: Simple Non-Cloning Engine

For engines that don't support voice cloning (e.g., multi-speaker models):

```python
def generate_audio(self, text, language, speaker_wav, parameters):
    # Ignore speaker_wav (not used)

    # Get speaker ID from parameters (if multi-speaker)
    speaker_id = parameters.get("speaker_id", 0)

    audio = self.model.synthesize(
        text=text,
        language=language,
        speaker_id=speaker_id
    )

    return self._to_wav_bytes(audio)
```

### Example 2: Cloud API Engine (OpenAI, ElevenLabs)

For engines that call external APIs:

```python
import httpx

def generate_audio(self, text, language, speaker_wav, parameters):
    # Get API key from environment
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    # Call OpenAI TTS API
    response = httpx.post(
        "https://api.openai.com/v1/audio/speech",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": "tts-1",
            "input": text,
            "voice": parameters.get("voice", "alloy")
        }
    )

    if response.status_code != 200:
        raise RuntimeError(f"API error: {response.text}")

    # OpenAI returns MP3, convert to WAV
    mp3_bytes = response.content
    return self._convert_mp3_to_wav(mp3_bytes)
```

### Example 3: Multi-Model Engine

For engines that support multiple models:

```python
def load_model(self, model_name: str):
    model_path = Path(__file__).parent / "models" / model_name

    # Unload previous model
    if self.model is not None:
        self.unload_model()

    # Load new model
    if model_name == "fast":
        self.model = FastTTS.load(model_path)
    elif model_name == "quality":
        self.model = QualityTTS.load(model_path)
    elif model_name == "multilingual":
        self.model = MultilingualTTS.load(model_path)
    else:
        raise ValueError(f"Unknown model: {model_name}")

    self.current_model = model_name
    self.logger.info(f"Loaded {model_name} model")
```

---

## Troubleshooting

### Engine Not Appearing in UI

**Check:**
1. `engine.yaml` exists and is valid YAML
2. `server.py` is executable
3. VENV is created (`venv/` directory exists)
4. VENV has dependencies installed
5. Backend logs show "Discovered engine: my_engine"

**Debug:**
```bash
# Test YAML parsing
python -c "import yaml; print(yaml.safe_load(open('engine.yaml')))"

# Test server startup manually
venv\Scripts\python server.py --port 8766
```

### Engine Starts But Health Check Fails

**Check:**
1. Server starts without errors
2. Port is not already in use
3. `/health` endpoint returns 200
4. No firewall blocking localhost

**Debug:**
```bash
# Check if port is available
netstat -an | grep 8766

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

**Check:**
1. GPU memory usage (`nvidia-smi`)
2. RAM usage (`Task Manager`)
3. Model size vs. available memory

**Solutions:**
- Use smaller models
- Implement model offloading (CPU ↔ GPU)
- Process text in smaller chunks
- Clear cache in `unload_model()`

### Dependency Conflicts

**Check:**
1. Each engine has its own VENV
2. `requirements.txt` doesn't include backend deps
3. Python version matches `engine.yaml`

**Solution:**
```bash
# Recreate VENV
rm -rf venv
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

---

## Advanced Topics

### Custom Parameters

Add custom UI controls for your engine:

```yaml
# engine.yaml
parameters:
  - name: "temperature"
    type: "slider"
    min: 0.1
    max: 2.0
    default: 1.0
    description: "Sampling temperature (higher = more creative)"

  - name: "top_p"
    type: "slider"
    min: 0.0
    max: 1.0
    default: 0.95
    description: "Nucleus sampling threshold"
```

Access in `generate_audio()`:
```python
temperature = parameters.get("temperature", 1.0)
top_p = parameters.get("top_p", 0.95)
```

### Hot Model Swapping

If your engine supports loading multiple models simultaneously:

```yaml
capabilities:
  supports_model_hotswap: true
```

```python
def load_model(self, model_name: str):
    # Don't unload previous model
    if model_name not in self.models:
        self.models[model_name] = YourTTS.load(model_name)

    self.current_model = model_name
```

### Streaming Support (Future)

Placeholder for future streaming support:

```yaml
capabilities:
  supports_streaming: true
```

```python
async def generate_audio_stream(self, text, language, speaker_wav, parameters):
    """Generate audio in chunks (async generator)"""
    for chunk in self.model.stream_synthesize(text):
        yield chunk
```

---

## Reference: XTTS Engine

The XTTS engine is a complete working example:

**Location:** `backend/engines/xtts/`

**Features:**
- Voice cloning from audio samples
- 17+ languages
- GPU acceleration (CUDA)
- Model hotswapping (v2.0.2 ↔ v2.0.3)

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
   - Add engine to `backend/engines/`
   - Update `README.md`
   - Submit pull request

3. **Checklist:**
   - [ ] Implements all 3 methods
   - [ ] Has `engine.yaml` with all fields
   - [ ] Has `requirements.txt`
   - [ ] Has `README.md`
   - [ ] Includes example audio samples
   - [ ] Works on Windows + Linux
   - [ ] Passes standalone tests

---

**Happy Engine Building! 🚀**
