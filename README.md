# Audiobook Maker

> A modern desktop application for creating audiobooks with advanced text-to-speech and voice cloning capabilities

[![Version](https://img.shields.io/badge/version-1.1.2-blue.svg)](https://github.com/DigiJoe79/audiobook-maker/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](https://tauri.app)

> **v1.1.2** - Simplified error handling with unified ApplicationError. See [Release Notes](docs/releases/RELEASE_v1.1.2.md).
>
> **v1.1.0** - Docker-based deployment, Remote GPU hosts, Engine variants. See [Release Notes](docs/releases/RELEASE_v1.1.0.md).

## Overview

**Audiobook Maker** is a powerful Tauri 2.0 desktop application that transforms text into high-quality audiobooks using state-of-the-art text-to-speech technology. Built with a modern tech stack combining React, TypeScript, and Python FastAPI, it offers professional-grade features in an intuitive interface.

### Key Features

- **Docker-Based Deployment** - One-command setup with prebuilt containers for backend and engines
- **Remote GPU Hosts** - Offload GPU-intensive engines to dedicated servers via SSH
- **Multi-Engine Architecture** - 4 engine types (TTS, STT, Text Processing, Audio Analysis)
- **Engine Variants** - Run engines locally (subprocess), in Docker, or on remote hosts
- **Voice Cloning** - Create custom voices using XTTS, Chatterbox, or VibeVoice with speaker samples
- **Quality Assurance** - Whisper-based transcription analysis and Silero-VAD audio quality detection
- **Pronunciation Rules** - Pattern-based text transformation to fix mispronunciations
- **Project Organization** - Hierarchical structure with Projects, Chapters, and Segments
- **Drag & Drop Interface** - Intuitive content organization and reordering
- **Multi-Language Support** - 17+ languages including English, German, Spanish, French, Chinese, Japanese
- **Multiple Export Formats** - Export to MP3, M4A, or WAV with quality presets
- **Smart Text Segmentation** - Automatic text splitting using spaCy NLP engine
- **Real-Time Updates** - Server-Sent Events for instant UI feedback
- **Job Management** - Database-backed queue, resume cancelled jobs, track progress
- **Markdown or EPUB Import** - Import entire projects from structured files

## Screenshots

![Alt text](/docs/screenshots/v1.0.0-start.png?raw=true "Startpage with profile selection")
![Alt text](/docs/screenshots/v1.0.0-generating.png?raw=true "Segment list with audio player")
![Alt text](/docs/screenshots/v1.0.0-import.png?raw=true "Markdown importer")
![Alt text](/docs/screenshots/v1.1.0-engine-manager.png?raw=true "Engine management")
![Alt text](/docs/screenshots/v1.1.0-host-manager.png?raw=true "Host-/image management")
![Alt text](/docs/screenshots/v1.1.0-add-host-ssh.png?raw=true "Add Host with SSH support")

## Sample audio
[Moby Dick Sample (Chatterbox)](docs/samples/Moby-Dick-Preview-Chatterbox.m4a?raw=true)

[Moby Dick Sample (VibeVoice)](docs/samples/Moby-Dick-Preview-VibeVoice.m4a?raw=true)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Audiobook Maker Desktop App                   │
│                     (Tauri + React Frontend)                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP/REST API + SSE
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Backend Container (Port 8765)                    │
│              ghcr.io/digijoe79/audiobook-maker/backend           │
├─────────────────────────────────────────────────────────────────┤
│  FastAPI │ SQLite │ TTS/Quality Workers │ Engine Managers        │
│          │        │                     │ (Docker Runner)        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Docker API
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Local Docker │   │  Local Docker │   │ Remote Docker │
│    Engines    │   │    Engines    │   │  Host (GPU)   │
│ xtts, spacy   │   │whisper,silero │   │ xtts,whisper  │
└───────────────┘   └───────────────┘   └───────────────┘
```

**Key Architecture Features:**
- Backend and engines run as Docker containers
- GPU engines can run on remote hosts via SSH tunnel
- Automatic engine discovery from online catalog
- Engine enable/disable with auto-stop after inactivity
- Real-time updates via Server-Sent Events (SSE)


## Quick Start

### Prerequisites

| Requirement | Purpose | Installation |
|-------------|---------|--------------|
| **Docker Desktop** | Run backend and engines | [Download](https://www.docker.com/products/docker-desktop/) |
| **NVIDIA Container Toolkit** | GPU support (optional) | [Install Guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) |

> **Note:** For GPU-accelerated TTS (XTTS, Chatterbox, Whisper), you need an NVIDIA GPU with CUDA support and the NVIDIA Container Toolkit installed.

### Installation

#### 1. Download the Desktop App

Download the latest Windows release from [GitHub Releases](https://github.com/DigiJoe79/audiobook-maker/releases):

- **Windows:** `Audiobook-Maker_1.1.1_x64-setup.exe`

> **Linux/macOS:** No prebuilt binaries available. See [Development Setup](#development-setup) to build from source.

#### 2. Pull the Backend Container

```bash
docker pull ghcr.io/digijoe79/audiobook-maker/backend:latest
```

#### 3. Start the Backend

```bash
docker run -d \
  --name audiobook-maker-backend \
  -p 8765:8765 \
  --add-host=host.docker.internal:host-gateway \
  -e DOCKER_ENGINE_HOST=host.docker.internal \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v audiobook-data:/app/data \
  -v audiobook-media:/app/media \
  ghcr.io/digijoe79/audiobook-maker/backend:latest
```

> **Important:** The container must be named `audiobook-maker-backend`. On startup, the backend cleans up orphaned engine containers (prefix `audiobook-`) from previous sessions. Containers matching this prefix are stopped unless explicitly excluded by name.

#### 4. Launch the App

1. Start the Audiobook Maker desktop app
2. Connect to backend: `http://localhost:8765`
3. Go to **Settings → Engines** and install engines from the catalog
4. Create a speaker and start creating audiobooks!

### Installing Engines

Engines are pulled automatically from the online catalog:

1. Open **Settings → Engines**
2. Browse available engines in the catalog
3. Click **Install** to pull the Docker image
4. Enable the engine and it starts automatically

See [audiobook-maker-engines](https://github.com/DigiJoe79/audiobook-maker-engines) for the full list of available engines.


## GPU Offloading to Remote Hosts

Run GPU-intensive engines on a dedicated server:

### 1. Prepare the Remote Host

```bash
# On the remote GPU server
# Install Docker and NVIDIA Container Toolkit
curl -fsSL https://get.docker.com | sh
# Follow NVIDIA Container Toolkit installation guide
```

### 2. Add Host in Audiobook Maker

1. Open **Settings → Hosts**
2. Click **Add Host**
3. Enter connection details:
   - **Host Name:** e.g., "GPU Server"
   - **SSH URL:** e.g., `ssh://user@192.168.1.100`
4. Click **Generate SSH Key**
5. Copy the displayed install command and run it on the remote host
6. Click **Test Connection** to verify
7. Click **Save**

### 3. Install Engines on Remote Host

1. Go to **Settings → Hosts**
2. Click on + for your remote host
3. Install (GPU) engines (XTTS, Whisper, etc.)
4. Engines run on the remote host, audio streams back to your machine


## Usage Guide

### Creating Your First Audiobook

1. **Create a Project** - Click "+" in the sidebar
2. **Add Chapters** - Organize your content
3. **Add Segments** - Upload text or type manually
4. **Configure Voice** - Select speaker and language
5. **Generate Audio** - Click "Generate All"
6. **Export** - Download as MP3/M4A/WAV

### Voice Cloning

1. Navigate to **Speakers** view (Ctrl+3)
2. Click **Add Speaker**
3. Upload 1-3 WAV samples (3-30 seconds each)
4. Use the speaker in your segments

### Quality Analysis

1. Generate audio for segments
2. Click quality indicator or use **Analyze Chapter**
3. Review transcription accuracy and audio metrics
4. Re-generate segments with issues

### Pronunciation Rules

1. Navigate to **Pronunciation** view (Ctrl+4)
2. Create rules for mispronounced words
3. Rules are automatically applied during generation


## Development Setup

For contributors who want to develop locally without Docker:

<details>
<summary><b>Development Installation (click to expand)</b></summary>

### Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org)
- **Python 3.12+** - [Download](https://www.python.org/downloads/)
- **Rust 1.70+** - [Install](https://rustup.rs)
- **FFmpeg** - [Install Guide](https://ffmpeg.org/download.html)

### Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate      # Windows
source venv/bin/activate   # Linux/Mac
pip install -r requirements.txt
```

### Engine Setup (Subprocess Mode)

Clone the engines repository:
```bash
git clone https://github.com/DigiJoe79/audiobook-maker-engines backend/engines
```

Set up individual engines:
```bash
cd backend/engines/tts/xtts
setup.bat   # Windows
./setup.sh  # Linux/Mac
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev:tauri
```

</details>

### Project Structure

```
audiobook-maker/
├── frontend/                 # Tauri + React desktop app
│   ├── src/                  # React components, hooks, stores
│   ├── src-tauri/            # Rust backend (Tauri)
│   └── e2e/                  # Playwright E2E tests
│
├── backend/                  # Python FastAPI backend
│   ├── api/                  # REST endpoints
│   ├── core/                 # Engine managers, Docker runner
│   ├── services/             # Business logic
│   └── Dockerfile            # Backend container definition
│
└── .github/workflows/        # CI/CD for container builds
```

### API Documentation

When the backend is running:
- **Swagger UI:** http://localhost:8765/docs
- **ReDoc:** http://localhost:8765/redoc


## Troubleshooting

### Enabling debug logs
Add `-e LOG_LEVEL=DEBUG` to the backend container for detailed logging. This is automatically passed through to engine containers.

```bash
docker run -d \
  --name audiobook-maker-backend \
  -e LOG_LEVEL=DEBUG \
  ...
```

### Backend container won't start
```bash
# Check logs
docker logs audiobook-maker-backend

# Verify port is available
docker ps -a | grep 8765
```

### Backend container stops immediately
The backend cleans up orphaned engine containers on startup. If your container is named differently than `audiobook-maker-backend`, it may be stopped as an orphan. Always use the exact name `audiobook-maker-backend`.

### GPU not detected in containers
```bash
# Verify NVIDIA Container Toolkit
nvidia-smi
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

### Engine fails to start
- Check engine logs in **Monitoring → Activity**
- Verify Docker has enough resources (memory, disk)
- For GPU engines, ensure NVIDIA Container Toolkit is installed

### Remote host connection fails
- Verify SSH key is in remote `~/.ssh/authorized_keys`
- Check firewall allows SSH (port 22)
- Test manually: `ssh user@host`

### Engine health checks fail with "Name or service not known"
This happens when running the backend container in a custom network (e.g., macvlan, custom bridge) where `host-gateway` doesn't resolve correctly.

**Symptoms:**
- Engine containers start but immediately stop
- Logs show: `Health check failed: [Errno -2] Name or service not known`

**Solutions:**

1. **Use host network mode** (recommended for NAS systems like Unraid):
   ```bash
   docker run -d \
     --name audiobook-maker-backend \
     --network host \
     --add-host=host.docker.internal:host-gateway \
     -e DOCKER_ENGINE_HOST=host.docker.internal \
     -v /var/run/docker.sock:/var/run/docker.sock \
     -v audiobook-data:/app/data \
     -v audiobook-media:/app/media \
     ghcr.io/digijoe79/audiobook-maker/backend:latest
   ```

2. **Or use explicit host IP**:
   ```bash
   -e DOCKER_ENGINE_HOST=192.168.1.X  # Your server's actual IP
   ```


## Tech Stack

### Frontend
- **Tauri 2.9** - Desktop framework
- **React 19** + **TypeScript 5.9** - UI framework
- **Material-UI 7** - Component library
- **React Query 5** - Server state
- **Zustand 5** - Local state

### Backend
- **Python 3.12** - Runtime
- **FastAPI** - Web framework
- **SQLite 3** - Database
- **Docker SDK** - Container management

### Engines
- **TTS:** XTTS v2, Chatterbox, VibeVoice
- **STT:** Whisper (5 model sizes)
- **Text:** spaCy (11 languages)
- **Audio:** Silero-VAD


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

### TTS Engines
- [Coqui TTS](https://github.com/coqui-ai/TTS) - XTTS v2 voice cloning engine
- [Chatterbox](https://github.com/resemble-ai/chatterbox) - Expressive TTS by Resemble AI
- [VibeVoice](https://github.com/microsoft/VibeVoice) - Long-form multi-speaker TTS by Microsoft

### Analysis Engines
- [OpenAI Whisper](https://github.com/openai/whisper) - Speech recognition
- [Silero VAD](https://github.com/snakers4/silero-vad) - Voice activity detection
- [spaCy](https://spacy.io) - NLP text segmentation

### Frameworks
- [Tauri](https://tauri.app) - Desktop app framework
- [FastAPI](https://fastapi.tiangolo.com) - Python web framework

## Support

- Issues: [GitHub Issues](https://github.com/DigiJoe79/audiobook-maker/issues)

---

Made with care by DigiJoe79
