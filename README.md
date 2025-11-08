# Audiobook Maker

> A modern desktop application for creating audiobooks with advanced text-to-speech and voice cloning capabilities

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/DigiJoe79/audiobook-maker/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](https://tauri.app)

## Overview

**Audiobook Maker** is a powerful Tauri 2.0 desktop application that transforms text into high-quality audiobooks using state-of-the-art text-to-speech technology. Built with a modern tech stack combining React, TypeScript, and Python FastAPI, it offers professional-grade features in an intuitive interface.

### Key Features

- **📚 Project Organization** - Hierarchical structure with Projects → Chapters → Segments
- **🎙️ Voice Cloning** - Create custom voices using XTTS engine with speaker samples
- **🔄 Drag & Drop Interface** - Intuitive content organization and reordering
- **🌍 Multi-Language Support** - 17+ languages including English, German, Spanish, French, Chinese, Japanese
- **🎵 Multiple Export Formats** - Export to MP3, M4A, or WAV with quality presets
- **✂️ Smart Text Segmentation** - Automatic text splitting using NLP (spaCy)
- **🎬 Scene Breaks** - Divider segments for customizable pauses
- **🔌 Plug-and-Play TTS Engines** - Add custom engines without code changes! ([Guide](docs/ENGINE_DEVELOPMENT_GUIDE.md))
- **⚡ Real-Time Updates** - Server-Sent Events for instant UI feedback (99.5% network reduction)
- **🔄 Job Management** - Resume cancelled jobs, track progress, persistent queue
- **💾 Session Recovery** - Automatically restore your work after disconnection
- **📝 Markdown Import** - Import entire projects from structured markdown files

## Screenshots

![Alt text](/docs/screenshots/v0.1.0-start.png?raw=true "Startpage with profile selection")
![Alt text](/docs/screenshots/v0.1.0-generation.png?raw=true "Startpage with profile selection")
![Alt text](/docs/screenshots/v0.1.0-speaker.png?raw=true "Startpage with profile selection")

## Tech Stack

### Frontend
- **[Tauri 2.1](https://tauri.app)** - Lightweight desktop framework (Rust + Web)
- **[React 18](https://react.dev)** + **[TypeScript 5.3](https://www.typescriptlang.org)** - Modern UI framework
- **[Material-UI 5](https://mui.com)** - Component library
- **[@tanstack/react-query](https://tanstack.com/query)** - Server state management
- **[@dnd-kit](https://dndkit.com)** - Drag & drop functionality
- **[Zustand](https://zustand-demo.pmnd.rs)** - Local state management
- **[Vite 5](https://vitejs.dev)** - Lightning-fast build tool

### Backend
- **[Python 3.10+](https://www.python.org)** - Backend runtime
- **[FastAPI 0.109](https://fastapi.tiangolo.com)** - Modern web framework
- **[Uvicorn](https://www.uvicorn.org)** - ASGI server
- **[SQLite 3](https://www.sqlite.org)** - Embedded database
- **[spaCy 3.7](https://spacy.io)** - NLP for text segmentation
- **[Loguru](https://loguru.readthedocs.io)** - Structured logging
- **[Pydantic 2](https://docs.pydantic.dev)** - Data validation

### TTS Engines
- **[XTTS v2](https://github.com/coqui-ai/TTS)** (v2.0.2 & v2.0.3) - High-quality voice cloning with optional GPU acceleration (CUDA)
- **Chatterbox** (experimental) - Research-grade TTS engine
- **Add Your Own!** - Plug-and-play system for custom engines ([Development Guide](docs/ENGINE_DEVELOPMENT_GUIDE.md)) 

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Tauri Desktop App                     │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────┐   │
│  │         React Frontend (Port 5173)               │   │
│  │   • Real-Time Updates (SSE)                      │   │
│  │   • Drag & Drop Layer (@dnd-kit)                 │   │
│  │   • State Management (React Query + Zustand)     │   │
│  │   • HTTP API Client (dynamic backend URL)        │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │      Rust Backend (Tauri Commands/IPC)           │   │
│  │   • File dialogs  • Health checks  • System API  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           │ HTTP/REST API + SSE
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Python Backend (Port 8765)                 │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  FastAPI     │  │   SQLite     │  │ TTS Worker   │   │
│  │  REST + SSE  │  │   Database   │  │ (Job Queue)  │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │Audio Export  │  │Text Segment  │  │  Speakers    │   │
│  │  (FFmpeg)    │  │   (spaCy)    │  │ Management   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Engine Manager (Auto-Discovery)          │   │
│  └──────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP (localhost)
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      
     │XTTS Engine  │  │Chatterbox   │  │Custom Engine│
     │(Port 8766)  │  │(Port 8767)  │  │(Port 876X)  │
     │Own VENV     │  │Own VENV     │  │Own VENV     │
     └─────────────┘  └─────────────┘  └─────────────┘
```

**New in v0.2.0:**
- Engine servers run in separate processes with isolated VENVs
- Real-time updates via Server-Sent Events (SSE)
- Database-backed job queue with resume functionality
- Auto-discovery system for plug-and-play engines

## Quick Start

### Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org)
- **Python 3.10+** - [Download](https://www.python.org/downloads/)
- **Rust 1.70+** - [Install](https://rustup.rs)
- **FFmpeg** - [Install Guide](https://ffmpeg.org/download.html)
- **CUDA 11.8 or 12.1** (optional, for GPU-accelerated TTS)

### Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/DigiJoe79/audiobook-maker.git
cd audiobook-maker
```

#### 2. Backend Core Setup

**⚠️ Important:** v0.2.0+ uses separate VENVs for backend and engines.

```bash
cd backend

# Windows
setup.bat

# Linux/Mac
chmod +x setup.sh
./setup.sh
```

This installs the backend core (FastAPI, spaCy, SQLite) **without TTS engines**.

<details>
<summary><b>Manual Setup (click to expand)</b></summary>

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Download spaCy language models
python install_spacy_models.py
```
</details>

#### 3. Engine Setup

```bash
cd backend/engines/xtts

# Windows
setup.bat

# Linux/Mac
chmod +x setup.sh
./setup.sh
```

This creates an **isolated VENV** for XTTS with PyTorch + CUDA support.

```bash
cd backend/engines/chatterbox

# Windows
setup.bat

# Linux/Mac
chmod +x setup.sh
./setup.sh
```

This creates an **isolated VENV** for Chatterbox with PyTorch + CUDA support.

#### 4. Frontend Setup

```bash
cd frontend  # From project root
npm install
```

#### 5. Start the Application

**Terminal 1 - Backend:**
```bash
cd backend
venv\Scripts\python main.py  # Windows
# OR
venv/bin/python main.py       # Linux/Mac
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev:tauri
```

The application will open automatically. On first launch:
1. Click "Connect to Backend"
2. Default URL: `http://localhost:8765` (should work automatically)
3. Select a TTS engine
4. Create a speaker and upload voice samples
5. Start creating audiobooks!

## Usage Guide

### Creating Your First Audiobook

1. **Create a Project**
   - Click the "+" button in the sidebar
   - Enter project name and optional description

2. **Add a Chapter**
   - Select your project
   - Click "Add Chapter"
   - Name your chapter

3. **Add Segments**
   - **Upload Text:** Click "Upload Text" to auto segment a chapter 
   - **Manual Entry:** Click "Add Segment" and paste/type your text
   - **Drag & Drop:** Drag the "Text Segment" button into the list

4. **Configure TTS Settings**
   - Open settings 
   - Choose speaker/voice
   - Select language
   - Adjust temperature and other parameters

5. **Generate Audio**
   - Click "Generate Audio" for individual segments
   - Or use "Generate All" for batch processing
   - Monitor progress in real-time

6. **Export Audiobook**
   - Click "Export Chapter"
   - Choose format (MP3/M4A/WAV)
   - Choose a quality preset
   - Download your audiobook!

### Advanced Features

#### Voice Cloning with XTTS

1. Navigate to "Speakers" tab
2. Click "Add Speaker"
3. Upload 1-3 WAV samples of the voice (each 3-30 seconds)
4. The engine will learn the voice characteristics
5. Use the speaker in your segments

#### Markdown Import Format

```markdown
# This is the Name of the Project
by Author
## Act 1 - This level is ignored
### Chapter 1: This is the Name of Chapter 1
This is the content of Chapter 1 - Scene 1
* * *
This is the content of Chapter 1 - Scene 2
* * *
This is the content of Chapter 1 - Scene 3
### Chapter 2: This is the Name of Chapter 2
This is the content of Chapter 2 - Scene 1
### Chapter 3: This is the Name of Chapter 3
This is the content of Chapter 3 - Scene 1
* * *
This is the content of Chapter 3 - Scene 2
```

## Development

### Project Structure

```
audiobook-maker/
├── frontend/                      # Tauri + React frontend
│   ├── src/
│   │   ├── components/            # React components
│   │   ├── contexts/              # React contexts (SSE)
│   │   ├── hooks/                 # Custom React hooks (React Query)
│   │   ├── pages/                 # Route components
│   │   ├── services/              # API clients
│   │   ├── store/                 # Zustand stores
│   │   └── types/                 # TypeScript definitions
│   ├── src-tauri/                 # Rust backend (Tauri)
│   └── tests/                     # Playwright E2E tests
│
├── backend/                       # Python FastAPI backend
│   ├── api/                       # FastAPI route handlers
│   │   ├── tts.py                 # TTS & job management
│   │   ├── events.py              # Server-Sent Events
│   │   └── ...
│   ├── core/                      # Core systems (NEW in v0.2.0)
│   │   ├── engine_discovery.py    # Auto-discover engines
│   │   ├── engine_manager.py      # Process management
│   │   └── tts_worker.py          # Background job worker
│   ├── services/                  # Business logic
│   │   ├── event_broadcaster.py   # SSE broadcaster
│   │   ├── audio_service.py       # Audio export
│   │   └── text_segmenter.py      # spaCy segmentation
│   ├── db/                        # Database layer
│   │   ├── database.py
│   │   └── repositories.py
│   ├── models/                    # Pydantic models
│   │   └── response_models.py     # API response models
│   ├── engines/                   # TTS Engine Servers (NEW in v0.2.0)
│   │   ├── base_server.py         # Base class for engines
│   │   ├── _template/             # Template for new engines
│   │   ├── xtts/                  # XTTS engine (own VENV)
│   │   │   ├── server.py
│   │   │   ├── engine.yaml
│   │   │   └── venv/
│   │   └── chatterbox/            # Chatterbox engine (own VENV)
│   │       ├── server.py
│   │       ├── engine.yaml
│   │       └── venv/
│   └── data/                      # Runtime data (audio, speakers)
│
├── docs/                          # Documentation
│
└── database/                      # SQLite schema
```

### API Documentation

When the backend is running, visit:
- **Swagger UI:** http://localhost:8765/docs
- **ReDoc:** http://localhost:8765/redoc

### Building for Production

```bash
cd frontend
npm run build:tauri

# Output:
# Windows: src-tauri/target/release/bundle/msi/
# Linux:   src-tauri/target/release/bundle/appimage/
# macOS:   src-tauri/target/release/bundle/dmg/
```
## Roadmap

### Current Version (0.2.0)
- ✅ Core audiobook creation workflow
- ✅ XTTS voice cloning integration
- ✅ Drag & drop organization
- ✅ Multi-format export (MP3/M4A/WAV)
- ✅ Real-time updates via Server-Sent Events (SSE)
- ✅ Database-backed job queue with resume functionality
- ✅ Plug-and-play engine system with auto-discovery
- ✅ Isolated VENVs per engine (no dependency conflicts)
- ✅ Session state preservation
- ✅ Markdown import

### Planned Features
- 🔄 Additional TTS engines
- 🔄 Whisper integration for quality checks
- 🔄 Pronunciation dictionary
- 🔄 Audio effects (normalization, noise reduction)

### For Developers
Want to add your own TTS engine? See the **[Engine Development Guide](docs/ENGINE_DEVELOPMENT_GUIDE.md)**!

## Troubleshooting

### Backend won't start
- Ensure Python 3.10+ is installed
- Check if port 8765 is available
- Verify virtual environment is activated
- Check FFmpeg is installed: `ffmpeg -version`

### CUDA/GPU issues
- For development, use the Dummy engine (no GPU required)
- Verify CUDA installation: `nvidia-smi`
- Check PyTorch CUDA support: `python -c "import torch; print(torch.cuda.is_available())"`

### Audio generation fails
- Check speaker samples are valid WAV files
- Verify spaCy models are installed: `python -m spacy validate`
- Check backend logs in console

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Coqui TTS](https://github.com/coqui-ai/TTS) - XTTS voice cloning engine
- [Tauri](https://tauri.app) - Desktop app framework
- [FastAPI](https://fastapi.tiangolo.com) - Backend framework
- [Material-UI](https://mui.com) - React component library
- [spaCy](https://spacy.io) - NLP library

## Support

- 🐛 Issues: [GitHub Issues](https://github.com/DigiJoe79/audiobook-maker/issues)

---

Made with ❤️ by DigiJoe79
