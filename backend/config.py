"""
Backend configuration settings
Centralized configuration for paths, directories, and environment-based settings
"""
import os
from pathlib import Path



BACKEND_ROOT = Path(__file__).parent

CONTENT_DIR = os.getenv("CONTENT_DIR", str(BACKEND_ROOT / "media"))

DATA_DIR = os.getenv("DATA_DIR", str(BACKEND_ROOT / "database"))

OUTPUT_DIR = os.getenv("OUTPUT_DIR", str(Path(CONTENT_DIR) / "output"))

EXPORTS_DIR = os.getenv("EXPORTS_DIR", str(Path(CONTENT_DIR) / "exports"))

SPEAKER_SAMPLES_DIR = os.getenv("SPEAKER_SAMPLES_DIR", str(Path(CONTENT_DIR) / "speaker_samples"))

TEST_AUDIO_DIR = os.getenv("TEST_AUDIO_DIR", str(Path(CONTENT_DIR) / "test_audio"))



DATABASE_PATH = os.getenv("DATABASE_PATH", str(Path(DATA_DIR) / "audiobook_maker.db"))

DUMMY_TEMPLATE_AUDIO = os.getenv("DUMMY_TEMPLATE_AUDIO", str(Path(TEST_AUDIO_DIR) / "test.wav"))



ENABLE_DUMMY_TTS = os.getenv("ENABLE_DUMMY_TTS", "true").lower() == "true"

XTTS_MODELS_DIR = os.getenv("XTTS_MODELS_DIR", str(BACKEND_ROOT / "xtts_models"))

DEFAULT_DEVICE = os.getenv("DEFAULT_DEVICE", "cpu")



DEFAULT_EXPORT_FORMAT = os.getenv("DEFAULT_EXPORT_FORMAT", "mp3")

DEFAULT_BITRATE = os.getenv("DEFAULT_BITRATE", "192k")

DEFAULT_SAMPLE_RATE = int(os.getenv("DEFAULT_SAMPLE_RATE", "24000"))

DEFAULT_PAUSE_MS = int(os.getenv("DEFAULT_PAUSE_MS", "500"))



HOST = os.getenv("HOST", "127.0.0.1")

PORT = int(os.getenv("PORT", "8765"))

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:1420").split(",")



LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")



def ensure_directories():
    """Create all required directories if they don't exist"""
    directories = [
        DATA_DIR,
        OUTPUT_DIR,
        EXPORTS_DIR,
        SPEAKER_SAMPLES_DIR,
        TEST_AUDIO_DIR,
    ]

    for directory in directories:
        Path(directory).mkdir(parents=True, exist_ok=True)


def get_config_summary() -> dict:
    """Get configuration summary for logging/debugging"""
    return {
        "data_dir": DATA_DIR,
        "output_dir": OUTPUT_DIR,
        "exports_dir": EXPORTS_DIR,
        "speaker_samples_dir": SPEAKER_SAMPLES_DIR,
        "test_audio_dir": TEST_AUDIO_DIR,
        "database_path": DATABASE_PATH,
        "dummy_template_audio": DUMMY_TEMPLATE_AUDIO,
        "enable_dummy_tts": ENABLE_DUMMY_TTS,
        "host": HOST,
        "port": PORT,
        "cors_origins": CORS_ORIGINS,
    }
