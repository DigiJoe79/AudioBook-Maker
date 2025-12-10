# Dockerfile for AudioBook-Maker backend + engines
# CPU focused, Python 3.10, Ubuntu based

FROM python:3.10-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Force UTF-8 so logs look sane
    PYTHONIOENCODING=utf-8

# System deps: build tools, FFmpeg, git (for future extras)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      build-essential \
      git \
      ca-certificates \
      curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what the backend needs (you can extend this later)
COPY backend/ backend/
COPY database/ database/

# Ensure setup scripts are executable
RUN chmod +x backend/setup.sh \
    && find backend/engines -name "setup.sh" -print -exec chmod +x {} \;

# Create backend venv and install core dependencies
# This uses the project's own setup script, which:
#  - creates backend/venv
#  - installs backend/requirements.txt
RUN cd backend && ./setup.sh

# Install engines inside the container using their own setup scripts.
# You can comment out engines you do not want.
RUN cd backend/engines/tts/xtts && ./setup.sh || echo "XTTS setup failed, continuing"
RUN cd backend/engines/text_processing/spacy && ./setup.sh || echo "spacy setup failed, continuing"
RUN cd backend/engines/audio_analysis/silero-vad && ./setup.sh || echo "Silero-VAD setup failed, continuing"
RUN cd backend/engines/stt/whisper && ./setup.sh || echo "Whisper setup failed, continuing"
RUN cd backend/engines/tts/chatterbox && ./setup.sh || echo "Chatterbox setup failed, continuing"

# Create directories for persistent data
#  - backend/media: audio files, speakers, etc.
#  - database: SQLite DB
RUN mkdir -p backend/media \
    && mkdir -p /app/database

# Expose FastAPI port (as in README)
EXPOSE 8765

# Default working dir and command
WORKDIR /app/backend

# Use the venv created by backend/setup.sh
CMD ["venv/bin/python", "main.py"]
