# Release v1.0.0 - Multi-Engine Architecture & Quality Assurance

This is a major release of **Audiobook Maker** featuring a complete multi-engine architecture, quality assurance system, performance optimizations, and modern UI navigation.

## Highlights

### Multi-Engine Architecture
- **4 Engine Types** - TTS, STT, Text Processing, and Audio Analysis
- **Isolated Virtual Environments** - Each engine runs in its own VENV (no dependency conflicts)
- **Engine Enable/Disable** - Per-engine enabled flag with database persistence
- **Auto-Stop** - Non-default engines automatically stop after 5 minutes of inactivity
- **Engine Monitoring UI** - Real-time status, memory usage, and auto-stop countdown
- **Plug-and-Play** - Add new engines without modifying backend code

### Quality Assurance System
- **Whisper Integration** - Automatic transcription analysis for quality verification
- **Silero-VAD** - Audio quality analysis (speech ratio, silence detection, clipping)
- **Confidence Scoring** - Detect low-quality or mispronounced segments (0-100%)
- **Issue Detection** - Identify missing words, extra words, mispronunciations
- **Quality Status** - Visual indicators (perfect/warning/defect) in segment list
- **Generic Quality Format** - Engine-agnostic result format for UI rendering

### Pronunciation Rules System
- **Pattern-Based Replacement** - Simple text or regex patterns to fix mispronunciations
- **Scope-Based Rules** - Global, engine-specific, project-specific, or project-engine
- **Priority System** - Control rule application order
- **Live Preview** - Test rules before applying
- **Import/Export** - JSON format for rule sharing
- **Automatic Application** - Rules applied during TTS generation

### Modern Navigation System
- **Teams/Discord-Style UI** - Icon-based sidebar with 6 views
- **Keyboard Shortcuts** - Ctrl+1 through Ctrl+6 for view switching
- **Collapsible Sidebar** - Ctrl+B to toggle
- **Event Log** - Real-time SSE event monitoring in Monitoring view

### Performance Optimizations
- **95% DOM Reduction** - Virtual scrolling with @tanstack/react-virtual
- **99% Fewer Re-renders** - React.memo optimization for list items
- **95% Faster Event Processing** - immer integration (1-2ms vs 20-30ms)
- **60fps Smooth Scrolling** - Even with 400+ segments

---

## New Features

### Multi-Engine Architecture

**Engine Types:**
| Type | Purpose | Engines Included |
|------|---------|------------------|
| **TTS** | Text-to-Speech | XTTS v2, Chatterbox, Kani (German) |
| **STT** | Speech-to-Text | OpenAI Whisper (5 model sizes) |
| **Text Processing** | Text Segmentation | spaCy (11 languages) |
| **Audio Analysis** | Audio Quality | Silero-VAD |

**Base Server Hierarchy:**
```
BaseEngineServer (Generic)
├── BaseTTSServer (adds /generate endpoint)
├── BaseQualityServer (adds /analyze endpoint)
└── BaseTextServer (adds /segment endpoint)
```

**Engine Management:**
- Enable/disable engines via Settings or API
- Auto-stop after 5 minutes inactivity (configurable)
- Real-time status monitoring (disabled/stopped/starting/running/stopping)
- Memory usage tracking
- Start/stop buttons in Monitoring view

### Quality Analysis System

**Unified Quality Format:**
- All engines return generic `AnalysisResult` with `qualityScore`, `qualityStatus`, `details`
- Frontend renders any engine's results dynamically
- Supports `fields` (key-value pairs) and `infoBlocks` (titled lists)

**Quality Levels:**
- `perfect` (score >= 85) - Green indicator
- `warning` (score 70-84) - Yellow indicator
- `defect` (score < 70) - Red indicator

**Analysis Types:**
- **STT Analysis (Whisper):** Transcription comparison, word-level confidence, text alignment
- **Audio Analysis (Silero-VAD):** Speech ratio, silence detection, clipping detection, volume analysis

### Navigation System

**6 Views:**
| View | Shortcut | Description |
|------|----------|-------------|
| Main | Ctrl+1 | Audiobook editing with AudioPlayer |
| Import | Ctrl+2 | Markdown import workflow |
| Speakers | Ctrl+3 | Speaker management |
| Pronunciation | Ctrl+4 | Pronunciation rules |
| Monitoring | Ctrl+5 | Jobs, Quality Jobs, Event Log, Engines |
| Settings | Ctrl+6 | 5 settings tabs |

**Additional Shortcuts:**
- Ctrl+B - Toggle sidebar
- Ctrl+[ - Go back to previous view
- Mac: Cmd instead of Ctrl

### Pronunciation Rules

- Create text transformation rules for mispronounced words
- Support regex and simple text patterns
- Scope system: global → engine → project → project-engine
- Priority ordering within scopes
- Active/inactive toggle
- Import/export as JSON

---

## Technical Changes

### Backend

**Multi-Engine System:**
- 4 Engine Managers inheriting from `BaseEngineManager`
- Auto-discovery per engine type from `backend/engines/{type}/`
- Unified `/models` endpoint returning `ModelInfo` objects
- Activity tracking with timestamps for auto-stop
- Engine enable/disable persisted in settings DB

**API Consolidation:**
- Jobs API: `/api/jobs/tts/*` and `/api/jobs/quality/*`
- Engine API: `/api/engines/status`, `/api/engines/{type}/{name}/enable|disable`
- Removed duplicate endpoints

**Quality System:**
- `QualityWorker` orchestrates STT + Audio engines
- Generic result format for all quality engines
- Quality jobs table with database persistence

**New Files:**
- `core/base_engine_manager.py` - Shared manager logic
- `core/base_engine_discovery.py` - Shared discovery logic
- `core/{tts,stt,text,audio}_engine_manager.py` - Type-specific managers
- `core/quality_worker.py` - Quality job processor
- `engines/base_quality_server.py` - STT + Audio base class
- `engines/base_text_server.py` - Text processing base class

### Frontend

**Navigation System:**
- `store/navigationStore.ts` - View state management
- `pages/*.tsx` - 6 main views + embedded views
- `components/layout/NavigationSidebar.tsx` - Icon sidebar

**Engine Management:**
- `components/engines/EngineCard.tsx` - Status card
- `components/engines/EngineStatusBadge.tsx` - Status indicator
- `hooks/useEngineQueries.ts` - React Query hooks

**Performance:**
- Virtual scrolling in SegmentList
- React.memo with custom comparisons
- immer for O(1) cache updates
- Stable references with useCallback

**SSE Handlers:**
- Split into 6 domain-specific hooks (2,555 LOC total)
- `useSSETTSHandlers` - TTS job events
- `useSSEQualityHandlers` - Quality analysis events
- `useSSESystemHandlers` - Health, settings, pronunciation
- `useSSESegmentHandlers` - Segment/chapter events
- `useSSEExportHandlers` - Export events
- `useSSEEngineHandlers` - Engine status events

### Database

**New Tables:**
- `pronunciation_rules` - Rule storage with scope
- `quality_jobs` - Quality job queue

**Engine Settings:**
- `settings.{type}.engines.{name}.enabled` - Per-engine enable flag

---

## Breaking Changes

### API Changes

**Removed Endpoints:**
- `/api/tts/engines/*` - Use `/api/engines/status` instead
- `/api/stt/*` legacy endpoints - Use `/api/quality/*` and `/api/jobs/quality/*`

**New Endpoints:**
- `GET /api/engines/status` - All engines status
- `POST /api/engines/{type}/{name}/enable` - Enable engine
- `POST /api/engines/{type}/{name}/disable` - Disable engine
- `POST /api/engines/{type}/{name}/start` - Start engine
- `POST /api/engines/{type}/{name}/stop` - Stop engine
- `POST /api/quality/analyze/segment` - Analyze single segment
- `POST /api/quality/analyze/chapter` - Analyze chapter
- `GET /api/jobs/quality/*` - Quality job management

### Engine Directory Structure

Engines moved to type-specific directories:
```
backend/engines/
├── tts/
│   ├── xtts/
│   ├── chatterbox/
│   └── kani/
├── stt/
│   └── whisper/
├── text_processing/
│   └── spacy/
└── audio_analysis/
    └── silero-vad/
```

### Response Model Changes

- `engine_model_name` replaces `tts_model_name` in discovery/managers
- All quality responses use generic `AnalysisResult` format

---

## Available Engines

### TTS Engines

| Engine | Languages | Features | Python |
|--------|-----------|----------|--------|
| **XTTS v2** | 17 | Voice cloning, model hotswap | 3.10 |
| **Chatterbox** | 23 | Voice cloning, fast generation | 3.11 |

### STT Engines

| Engine | Languages | Models | Python |
|--------|-----------|--------|--------|
| **Whisper** | 12 | tiny, base, small, medium, large | 3.12 |

### Text Processing Engines

| Engine | Languages | Features | Python |
|--------|-----------|----------|--------|
| **spaCy** | 11 | MD models only, CPU-only | 3.12 |

### Audio Analysis Engines

| Engine | Features | Python |
|--------|----------|--------|
| **Silero-VAD** | Speech/silence detection, clipping, volume | 3.12 |

---

## Known Issues

- Virtual scrolling may have slight visual jitter on rapid scroll
- Pronunciation rules with complex regex may impact generation speed
- Quality analysis may take some time for long chapters

---

## For Developers

### Adding Custom Engines

See the updated **[Engine Development Guide](../ENGINE_DEVELOPMENT_GUIDE.md)** for complete documentation.

**Quick Start:**
1. Choose engine type (TTS, STT, Text, Audio)
2. Copy template: `cp -r backend/engines/{type}/_template backend/engines/{type}/my_engine`
3. Implement required methods:
   - TTS: `load_model()`, `generate_audio()`, `unload_model()`, `get_available_models()`
   - STT/Audio: `load_model()`, `analyze_audio()`, `unload_model()`, `get_available_models()`
4. Configure `engine.yaml`
5. Create VENV and install dependencies
6. Restart backend - engine appears automatically!

---

## Full Changelog

### v0.3.0 (not released on Github)
- Quality Assurance with Whisper STT analysis
- Pronunciation Rules System
- Performance optimizations (virtual scrolling, immer)
- SSE handler refactoring (6 domain-specific hooks)
- Component reorganization

### v0.4.0 (not released on Github)
- Multi-Engine Architecture (4 engine types)
- Engine enable/disable with auto-stop
- Complete dependency isolation

### v0.4.1 (not released on Github)
- BaseEngineServer refactoring
- Unified `/models` endpoint
- Silero-VAD audio analysis engine

### v0.4.2 (not released on Github)
- Jobs API consolidation
- Engine API consolidation
- Base class hierarchy (BaseQualityServer, BaseTextServer)

### v0.4.3 (not released on Github)
- SSE event consistency (create/delete/reorder events)
- Channel unification for chapter events
- Bug fixes in SSE handlers

### v1.0.0
- First stable release
- Documentation updates
- Final polish and bug fixes

---

**Full Changelog**: https://github.com/DigiJoe79/audiobook-maker/compare/v0.2.0...v1.0.0

## Contributors

Built with Tauri 2.9, React 19, Python FastAPI, powered by XTTS v2/Chatterbox for voice cloning, OpenAI Whisper for quality analysis, and Silero-VAD for audio analysis.

---

**Thank you for using Audiobook Maker!**
