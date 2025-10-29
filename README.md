# Audiobook Maker

> A modern desktop application for creating audiobooks with advanced text-to-speech and voice cloning capabilities

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/DigiJoe79/audiobook-maker)
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
- **🔌 Multi-Engine Architecture** - Extensible TTS system (XTTS, more coming)
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
- **more TTS Engines coming** 

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Tauri Desktop App                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │         React Frontend (Port 5173)               │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │  StartPage (/)  → Backend Connection       │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │  MainApp (/app) → Protected Main UI        │  │   │
│  │  │   • Drag & Drop Layer (@dnd-kit)           │  │   │
│  │  │   • State Management (React Query+Zustand) │  │   │
│  │  │   • HTTP API Client (dynamic backend URL)  │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │      Rust Backend (Tauri Commands/IPC)           │   │
│  │   • File dialogs  • Health checks  • System API  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
                           │
                           │ HTTP/REST API
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Python Backend (Port 8765)                 │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  FastAPI     │  │  TTS Engines │  │   SQLite     │   │
│  │  REST API    │  │  (XTTS)      │  │   Database   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Audio Export │  │ Text Segment │  │   Speakers   │   │
│  │  (FFmpeg)    │  │   (spaCy)    │  │  Management  │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────┘
```

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

#### 2. Backend Setup

```bash
# Windows quick install
cd backend
install_backend.bat
```

**or**

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install PyTorch with CUDA support (optional, for GPU)
# For CUDA 11.8:
pip install torch==2.1.1+cu118 torchaudio==2.1.1+cu118 --index-url https://download.pytorch.org/whl/cu118
# For CUDA 12.1:
pip install torch==2.1.1+cu121 torchaudio==2.1.1+cu121 --index-url https://download.pytorch.org/whl/cu121
# For CPU only:
pip install torch==2.1.1 torchaudio==2.1.1

# Install dependencies
pip install -r requirements.txt

# Download spaCy language models
python install_spacy_models.py

# Download recommended XTTS model(2.0.2)
python install_xtts_models.py
```

#### 3. Frontend Setup

```bash
cd ../frontend
npm install
```

#### 4. Start the Backend

```bash
# Windows quick start
cd backend
start_backend.bat
```

**or**

```bash
cd backend

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

python main.py
```

#### 5. Run the Application

```bash
cd frontend
npm run dev:tauri
```

The application will open automatically. On first launch:
1. Click "Connect to Backend"
2. Default URL: `http://localhost:8765` (should work automatically)
3. Create a speaker and upload at least one sample for voice cloning
4. Start creating audiobooks!

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
├── frontend/              # Tauri + React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom React hooks (React Query)
│   │   ├── pages/         # Route components
│   │   ├── services/      # API clients
│   │   ├── store/         # Zustand stores
│   │   └── types/         # TypeScript definitions
│   ├── src-tauri/         # Rust backend (Tauri)
│   └── tests/             # Playwright E2E tests
│
├── backend/               # Python FastAPI backend
│   ├── api/               # FastAPI route handlers
│   ├── services/          # Business logic
│   │   ├── xtts_engine.py
│   │   ├── audio_service.py
│   │   └── text_segmenter.py
│   ├── db/                # Database layer
│   ├── models/            # Pydantic models
│   └── data/              # Runtime data (audio, speakers)
│
└── database/              # SQLite schema
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

### Current Version (0.1.0)
- ✅ Core audiobook creation workflow
- ✅ XTTS voice cloning integration
- ✅ Drag & drop organization
- ✅ Multi-format export (MP3/M4A/WAV)
- ✅ Session state preservation
- ✅ Markdown import

### Planned Features
- 🔄 Additional TTS engines (OpenAI TTS, ElevenLabs, Azure)
- 🔄 Whisper integration for quality checks
- 🔄 Pronunciation dictionary
- 🔄 Audio effects (normalization, noise reduction)

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
- 💬 Discussions: [GitHub Discussions](https://github.com/DigiJoe79/audiobook-maker/discussions)

---

Made with ❤️ by DigiJoe79
