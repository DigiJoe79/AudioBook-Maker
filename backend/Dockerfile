# =============================================================================
# Audiobook Maker - Backend Core Container
# =============================================================================
# Build:   docker build -t audiobook-maker/backend:latest -f backend/Dockerfile .
# Run:     docker run -d -p 8765:8765 \
#            -v /var/run/docker.sock:/var/run/docker.sock \
#            -v ./data:/app/data \
#            -v ./media:/app/media \
#            audiobook-maker/backend:latest
#
# Registry: ghcr.io/digijoe79/audiobook-maker/backend
# =============================================================================

FROM python:3.12-slim

# Build argument for version injection (from CI/CD)
ARG VERSION=dev
ENV APP_VERSION=${VERSION}

WORKDIR /app

# Install system dependencies
# - ffmpeg: Required by pydub for audio processing
# - curl: For healthcheck
# - openssh-client: For remote Docker host connections (ssh-keyscan)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Create and activate virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./
COPY database/schema.sql ./database/

# Remove development artifacts that might have been copied
RUN rm -rf venv/ .pytest_cache/ .ruff_cache/ __pycache__/ \
    && find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# Create directories for persistent data
RUN mkdir -p /app/data /app/media/output /app/media/exports /app/media/speaker_samples

# Environment configuration
ENV PYTHONUNBUFFERED=1
ENV HOST=0.0.0.0
ENV PORT=8765

# Data paths (mount volumes to these locations)
ENV DATA_DIR=/app/data
ENV DATABASE_PATH=/app/data/audiobook_maker.db
ENV CONTENT_DIR=/app/media
ENV OUTPUT_DIR=/app/media/output
ENV EXPORTS_DIR=/app/media/exports
ENV SPEAKER_SAMPLES_DIR=/app/media/speaker_samples

# Default to Docker runner mode (no subprocess engines in container)
ENV DEFAULT_ENGINE_RUNNER=docker

EXPOSE 8765

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Start the backend server
# nosemgrep: dockerfile.security.missing-user.missing-user -- requires root for Docker socket access
CMD ["sh", "-c", "python main.py --host ${HOST} --port ${PORT}"]
