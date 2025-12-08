"""
Backend configuration settings
Centralized configuration for paths, directories, and environment-based settings
"""
import os
from pathlib import Path


# ===== Base Directories =====

# Backend root directory
BACKEND_ROOT = Path(__file__).parent

# Content root directory
CONTENT_DIR = os.getenv("CONTENT_DIR", str(BACKEND_ROOT / "media"))

# Data directory (database, runtime files)
DATA_DIR = os.getenv("DATA_DIR", str(BACKEND_ROOT / "database"))

# Audio output directory
OUTPUT_DIR = os.getenv("OUTPUT_DIR", str(Path(CONTENT_DIR) / "output"))

# Audio exports subdirectory
EXPORTS_DIR = os.getenv("EXPORTS_DIR", str(Path(CONTENT_DIR) / "exports"))

# Speaker samples directory
SPEAKER_SAMPLES_DIR = os.getenv("SPEAKER_SAMPLES_DIR", str(Path(CONTENT_DIR) / "speaker_samples"))


# ===== File Paths =====

# Database file path
DATABASE_PATH = os.getenv("DATABASE_PATH", str(Path(DATA_DIR) / "audiobook_maker.db"))


# ===== Engine Configuration =====

# HTTP client timeout for engine communication (seconds)
ENGINE_HTTP_TIMEOUT = int(os.getenv("ENGINE_HTTP_TIMEOUT", "300"))

# Engine startup/shutdown timeout (seconds)
ENGINE_SHUTDOWN_TIMEOUT = int(os.getenv("ENGINE_SHUTDOWN_TIMEOUT", "10"))

# Engine health check timeout (seconds)
ENGINE_HEALTH_CHECK_TIMEOUT = int(os.getenv("ENGINE_HEALTH_CHECK_TIMEOUT", "5"))

# Engine analysis timeout for STT/Audio operations (seconds)
ENGINE_ANALYSIS_TIMEOUT = int(os.getenv("ENGINE_ANALYSIS_TIMEOUT", "120"))

# Discovery mode engine auto-stop timeout (seconds)
ENGINE_DISCOVERY_TIMEOUT = int(os.getenv("ENGINE_DISCOVERY_TIMEOUT", "30"))

# Idle engine check interval (seconds)
IDLE_ENGINE_CHECK_INTERVAL = int(os.getenv("IDLE_ENGINE_CHECK_INTERVAL", "60"))

# Port allocation range
ENGINE_PORT_START = int(os.getenv("ENGINE_PORT_START", "8766"))
ENGINE_PORT_MAX = int(os.getenv("ENGINE_PORT_MAX", "65535"))


# ===== Worker Configuration =====

# TTS worker poll interval (seconds)
TTS_WORKER_POLL_INTERVAL = float(os.getenv("TTS_WORKER_POLL_INTERVAL", "1.0"))

# Quality worker poll interval (seconds)
QUALITY_WORKER_POLL_INTERVAL = float(os.getenv("QUALITY_WORKER_POLL_INTERVAL", "1.0"))

# Worker stop timeout (seconds)
WORKER_STOP_TIMEOUT = float(os.getenv("WORKER_STOP_TIMEOUT", "10.0"))


# ===== Database Configuration =====

# Database connection timeout (seconds)
DB_CONNECTION_TIMEOUT = float(os.getenv("DB_CONNECTION_TIMEOUT", "30.0"))

# Database retry configuration
DB_LOCK_MAX_RETRIES = int(os.getenv("DB_LOCK_MAX_RETRIES", "5"))
DB_LOCK_INITIAL_DELAY = float(os.getenv("DB_LOCK_INITIAL_DELAY", "0.1"))

# Database query limits
DB_JOBS_ACTIVE_LIMIT = int(os.getenv("DB_JOBS_ACTIVE_LIMIT", "100"))
DB_JOBS_EXISTENCE_CHECK_LIMIT = int(os.getenv("DB_JOBS_EXISTENCE_CHECK_LIMIT", "1"))
DB_PRONUNCIATION_RULES_LIMIT = int(os.getenv("DB_PRONUNCIATION_RULES_LIMIT", "1000"))


# ===== SSE Configuration =====

# SSE keepalive timeout (seconds)
SSE_KEEPALIVE_TIMEOUT = float(os.getenv("SSE_KEEPALIVE_TIMEOUT", "15.0"))

# Health monitor check interval (seconds)
HEALTH_MONITOR_INTERVAL = int(os.getenv("HEALTH_MONITOR_INTERVAL", "1"))

# Health monitor stop timeout (seconds)
HEALTH_MONITOR_STOP_TIMEOUT = float(os.getenv("HEALTH_MONITOR_STOP_TIMEOUT", "2.0"))


# ===== HTTP Cache Configuration =====

# Static audio files cache max-age (seconds) - 1 year for immutable content
STATIC_AUDIO_CACHE_MAX_AGE = int(os.getenv("STATIC_AUDIO_CACHE_MAX_AGE", "31536000"))


# ===== Import Validation Configuration =====

# Maximum chapter length for import validation (characters)
IMPORT_MAX_CHAPTER_LENGTH = int(os.getenv("IMPORT_MAX_CHAPTER_LENGTH", "30000"))

# Maximum segment length for import validation (characters)
IMPORT_MAX_SEGMENT_LENGTH = int(os.getenv("IMPORT_MAX_SEGMENT_LENGTH", "1000"))
