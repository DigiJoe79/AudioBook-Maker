# Audiobook Maker

> A modern desktop application for creating audiobooks with advanced text-to-speech and voice cloning capabilities

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/DigiJoe79/audiobook-maker/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](https://tauri.app)

## Overview

**Audiobook Maker** is a powerful Tauri 2.0 desktop application that transforms text into high-quality audiobooks using state-of-the-art text-to-speech technology. Built with a modern tech stack combining React, TypeScript, and Python FastAPI, it offers professional-grade features in an intuitive interface.

### Key Features

- **Multi-Engine Architecture** - 4 engine types (TTS, STT, Text Processing, Audio Analysis) with isolated VENVs
- **Voice Cloning** - Create custom voices using XTTS or Chatterbox with speaker samples
- **Quality Assurance** - Whisper-based transcription analysis and Silero-VAD audio quality detection
- **Pronunciation Rules** - Pattern-based text transformation to fix mispronunciations
- **Project Organization** - Hierarchical structure with Projects, Chapters, and Segments
- **Drag & Drop Interface** - Intuitive content organization and reordering
- **Multi-Language Support** - 17+ languages including English, German, Spanish, French, Chinese, Japanese
- **Multiple Export Formats** - Export to MP3, M4A, or WAV with quality presets
- **Smart Text Segmentation** - Automatic text splitting using spaCy NLP engine
- **Real-Time Updates** - Server-Sent Events for instant UI feedback (99.5% network reduction)
- **Job Management** - Database-backed queue, resume cancelled jobs, track progress
- **Engine Management** - Enable/disable engines, auto-stop after inactivity, monitoring UI
- **Markdown Import** - Import entire projects from structured markdown files

## Screenshots

![Alt text](/docs/screenshots/v1.0.0-start.png?raw=true "Startpage with profile selection")
![Alt text](/docs/screenshots/v1.0.0-generating.png?raw=true "Segment list with audio player")
![Alt text](/docs/screenshots/v1.0.0-import.png?raw=true "Markdown importer")
![Alt text](/docs/screenshots/v1.0.0-engine-manager.png?raw=true "Engine management")

## Tech Stack

### Frontend
- **[Tauri 2.9](https://tauri.app)** - Lightweight desktop framework (Rust + Web)
- **[React 19.2](https://react.dev)** + **[TypeScript 5.9](https://www.typescriptlang.org)** - Modern UI framework
- **[Material-UI 7.3](https://mui.com)** - Component library
- **[@tanstack/react-query 5.90](https://tanstack.com/query)** - Server state management
- **[@tanstack/react-virtual 3.13](https://tanstack.com/virtual)** - Virtualized lists (400+ segments at 60fps)
- **[@dnd-kit 6.3](https://dndkit.com)** - Drag & drop functionality
- **[Zustand 5.0](https://zustand-demo.pmnd.rs)** - Local state management
- **[Vite 7.2](https://vitejs.dev)** - Lightning-fast build tool

### Backend
- **[Python 3.10+](https://www.python.org)** - Backend runtime
- **[FastAPI 0.123+](https://fastapi.tiangolo.com)** - Modern web framework
- **[Uvicorn 0.38+](https://www.uvicorn.org)** - ASGI server
- **[SQLite 3](https://www.sqlite.org)** - Embedded database
- **[Loguru 0.7](https://loguru.readthedocs.io)** - Structured logging
- **[Pydantic 2.10](https://docs.pydantic.dev)** - Data validation

### Engines (Isolated VENVs)
- **TTS:** XTTS v2 (coqui-tts 0.27), Chatterbox 0.1.4, Kani (German-only)
- **STT:** OpenAI Whisper (5 model sizes: tiny/base/small/medium/large)
- **Text Processing:** spaCy 3.8+ (11 languages)
- **Audio Analysis:** Silero-VAD 6.2+ (speech/silence detection)

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
│  │  FastAPI     │  │   SQLite     │  │   Workers    │   │
│  │  REST + SSE  │  │   Database   │  │ TTS + Quality│   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │Audio Export  │  │Pronunciation │  │  Speakers    │   │
│  │  (FFmpeg)    │  │    Rules     │  │ Management   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │     4 Engine Managers (TTS, STT, Text, Audio)    │   │
│  │  • Auto-Discovery  • Enable/Disable  • Auto-Stop │   │
│  └──────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP (localhost)
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
 ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
 │  TTS Engines  │  │  STT Engine   │  │ Other Engines │
 │ XTTS/Chatter  │  │   Whisper     │  │ spaCy/Silero  │
 │  Own VENVs    │  │   Own VENV    │  │   Own VENVs   │
 └───────────────┘  └───────────────┘  └───────────────┘
```

**Key Architecture Features:**
- Engine servers run in separate processes with isolated VENVs
- Real-time updates via Server-Sent Events (SSE)
- Database-backed job queue with resume functionality
- Auto-discovery system for plug-and-play engines
- Engine enable/disable with auto-stop after 5 minutes inactivity
- Virtual scrolling for 400+ segments at 60fps

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

```bash
cd backend

# Windows
setup.bat

# Linux/Mac
chmod +x setup.sh
./setup.sh
```

This installs the backend core (FastAPI, SQLite) **without engines**.

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
```
</details>

#### 3. Engine Setup

Each engine has its own isolated virtual environment:

**XTTS (TTS with voice cloning):**
```bash
cd backend/engines/tts/xtts
setup.bat   # Windows
./setup.sh  # Linux/Mac
```

**Chatterbox (Alternative TTS):**
```bash
cd backend/engines/tts/chatterbox
setup.bat   # Windows
./setup.sh  # Linux/Mac
```

**spaCy (Text Segmentation):**
```bash
cd backend/engines/text_processing/spacy
setup.bat   # Windows
./setup.sh  # Linux/Mac
```

**Silero-VAD (Quality Analysis - Optional):**
```bash
cd backend/engines/audio_analysis/silero-vad
setup.bat   # Windows
./setup.sh  # Linux/Mac
```

**Whisper (Quality Analysis - Optional):**
```bash
cd backend/engines/stt/whisper
setup.bat   # Windows
./setup.sh  # Linux/Mac
```

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
venv/bin/python main.py      # Linux/Mac
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

1. Navigate to "Speakers" view (Ctrl+3)
2. Click "Add Speaker"
3. Upload 1-3 WAV samples of the voice (each 3-30 seconds)
4. The engine will learn the voice characteristics
5. Use the speaker in your segments

#### Quality Analysis

1. Generate audio for your segments
2. Click the quality indicator on a segment
3. Or analyze entire chapters with "Analyze Chapter"
4. Review transcription accuracy and audio quality metrics
5. Re-generate segments with issues

#### Pronunciation Rules

1. Navigate to "Pronunciation" view (Ctrl+4)
2. Create rules for words that are mispronounced
3. Use simple text or regex patterns
4. Rules are automatically applied during generation

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
│   │   ├── hooks/                 # Custom React hooks
│   │   ├── pages/                 # View components
│   │   ├── services/              # API clients
│   │   ├── store/                 # Zustand stores
│   │   └── types/                 # TypeScript definitions
│   ├── src-tauri/                 # Rust backend (Tauri)
│   └── e2e/                       # Playwright E2E tests
│
├── backend/                       # Python FastAPI backend
│   ├── api/                       # FastAPI route handlers
│   ├── core/                      # Engine managers, workers
│   ├── services/                  # Business logic
│   ├── db/                        # Database layer
│   ├── models/                    # Pydantic models
│   ├── engines/                   # Engine Servers (Isolated VENVs)
│   │   ├── tts/                   # TTS engines
│   │   │   ├── xtts/              # XTTS v2 (voice cloning)
│   │   │   ├── chatterbox/        # Chatterbox TTS
│   │   ├── stt/                   # STT engines
│   │   │   └── whisper/           # OpenAI Whisper
│   │   ├── text_processing/       # Text engines
│   │   │   └── spacy/             # spaCy NLP
│   │   └── audio_analysis/        # Audio engines
│   │       └── silero-vad/        # Silero VAD
│   └── media/                     # Runtime data (audio, speakers)
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

### Adding Custom Engines

Want to add your own TTS, STT, or analysis engine? See the **[Engine Development Guide](docs/ENGINE_DEVELOPMENT_GUIDE.md)**!

**Quick overview:**
1. Copy template from `backend/engines/{type}/_template`
2. Implement 3-4 methods (load, generate/analyze, unload, get_models)
3. Configure `engine.yaml`
4. Create isolated VENV
5. Restart backend - engine appears automatically!

## Roadmap

### Current Version (1.0.0)
- Core audiobook creation workflow
- Multi-engine architecture (TTS, STT, Text, Audio)
- XTTS and Chatterbox voice cloning
- Whisper quality analysis
- Silero-VAD audio analysis
- spaCy text segmentation
- Pronunciation rules system
- Drag & drop organization
- Multi-format export (MP3/M4A/WAV)
- Real-time updates via SSE
- Database-backed job queue
- Engine enable/disable with auto-stop
- Engine monitoring UI
- Virtual scrolling (400+ segments at 60fps)
- Markdown import

## Troubleshooting

### Backend won't start
- Ensure Python 3.10+ is installed
- Check if port 8765 is available
- Verify virtual environment is activated
- Check FFmpeg is installed: `ffmpeg -version`

### CUDA/GPU issues
- For development, disable GPU engines in Settings
- Verify CUDA installation: `nvidia-smi`
- Check PyTorch CUDA support: `python -c "import torch; print(torch.cuda.is_available())"`

### Audio generation fails
- Check speaker samples are valid WAV files
- Verify engine is running (check Monitoring view)
- Check backend logs in console

### Engine not starting
- Check engine is enabled in Settings
- Verify VENV exists and dependencies installed
- Run engine manually to see errors:
  ```bash
  cd backend/engines/{type}/{engine}
  venv\Scripts\python server.py --port 8766
  ```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Coqui TTS](https://github.com/coqui-ai/TTS) - XTTS voice cloning engine
- [Chatterbox](https://github.com/resemble-ai/chatterbox) - Chatterbox TTS engine
- [OpenAI Whisper](https://github.com/openai/whisper) - Speech recognition
- [Silero VAD](https://github.com/snakers4/silero-vad) - Voice activity detection
- [spaCy](https://spacy.io) - NLP library
- [Tauri](https://tauri.app) - Desktop app framework
- [FastAPI](https://fastapi.tiangolo.com) - Backend framework
- [Material-UI](https://mui.com) - React component library

## Support

- Issues: [GitHub Issues](https://github.com/DigiJoe79/audiobook-maker/issues)

---

Made with care by DigiJoe79
