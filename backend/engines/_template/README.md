# Template TTS Engine

This is a template for creating new TTS engine servers.

## Quick Start

1. **Copy this template:**
   ```bash
   cp -r backend/engines/_template backend/engines/my_engine
   cd backend/engines/my_engine
   ```

2. **Customize files:**
   - `server.py` - Implement `load_model()`, `generate_audio()`, `unload_model()`
   - `engine.yaml` - Configure name, capabilities, models, languages
   - `requirements.txt` - Add your engine dependencies

3. **Create virtual environment:**
   ```bash
   # Windows
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt

   # Linux/Mac
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

4. **Test standalone:**
   ```bash
   # Windows
   venv\Scripts\python.exe server.py --port 8766

   # Linux/Mac
   venv/bin/python server.py --port 8766
   ```

5. **Restart backend** - Engine will be auto-discovered! ✅

## Implementation Guide

### Required Methods

Engines must implement 3 methods:

```python
def load_model(self, model_name: str) -> None:
    """
    Load model into memory

    Args:
        model_name: Model identifier from engine.yaml (e.g., 'v2.0.3')

    Raises:
        Exception: If loading fails
    """
    pass

def generate_audio(
    self,
    text: str,
    language: str,
    speaker_wav: Union[str, List[str]],
    parameters: Dict[str, Any]
) -> bytes:
    """
    Generate TTS audio

    Args:
        text: Text to synthesize
        language: Language code (e.g., 'en', 'de')
        speaker_wav: Path(s) to speaker sample(s)
        parameters: Engine-specific parameters

    Returns:
        WAV audio as bytes

    Raises:
        Exception: If generation fails
    """
    pass

def unload_model(self) -> None:
    """
    Unload model and free resources
    """
    pass
```

### FastAPI Endpoints (Auto-Generated)

The `BaseEngineServer` provides these endpoints automatically:

- `POST /load` - Load model
- `POST /generate` - Generate audio (returns WAV bytes)
- `GET /health` - Health check
- `POST /shutdown` - Graceful shutdown

No need to implement routes - focus on TTS logic!

### Configuration (engine.yaml)

```yaml
name: "my_engine"
display_name: "My TTS Engine"
version: "1.0.0"

venv_path: "./venv"

capabilities:
  supports_model_hotswap: true   # Can switch models without restart
  supports_speaker_cloning: true
  supports_streaming: false

models:
  - name: "v1"
    path: "./models/v1"
    display_name: "My Model v1"

supported_languages:
  - en
  - de
```

## Directory Structure

```
my_engine/
├── server.py          # Engine implementation (inherits from BaseEngineServer)
├── engine.yaml        # Configuration
├── requirements.txt   # Dependencies
├── setup.bat          # Windows setup script
├── setup.sh           # Linux/Mac setup script
├── venv/              # Virtual environment
└── models/            # Model files
    └── v1/
        └── model.bin
```

## Tips

- **Error Handling**: Raise exceptions in `load_model()` and `generate_audio()` - BaseEngineServer handles HTTP errors
- **Logging**: Use `logger.info()`, `logger.error()` - already imported
- **State**: Store model in `self.model`, config in `self.config`
- **Audio Format**: Return WAV bytes (use `io.BytesIO()` + `torchaudio.save()` or equivalent)
- **Speaker Samples**: `speaker_wav` can be a string (single file) or list (multiple files)

## Testing

Test your engine standalone before integrating:

```bash
# Start server
venv\Scripts\python.exe server.py --port 8766

# Test health check
curl http://localhost:8766/health

# Test load
curl -X POST http://localhost:8766/load -H "Content-Type: application/json" -d '{"modelName":"v1"}'

# Test generate
curl -X POST http://localhost:8766/generate -H "Content-Type: application/json" \
  -d '{"text":"Hello world","language":"en","speakerWav":"","parameters":{}}' \
  --output test.wav
```

## Examples

See `backend/engines/xtts/` for a complete working example.
