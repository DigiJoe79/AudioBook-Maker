# Release v0.2.0 - Architecture & Performance Update

This is a major update to **Audiobook Maker** focusing on architecture improvements, real-time updates, and performance optimizations.

## Highlights

### Real-Time Updates & Performance
- **Server-Sent Events (SSE)** - Push-based real-time updates for instant UI feedback
- **99.5% Network Reduction** - 2,000+ requests reduced to ~50 during 10-minute generation
- **Zero Polling** - Complete elimination of aggressive polling when SSE is active
- **Instant Visual Feedback** - Segments show status changes immediately without delays

### Architecture Improvements
- **Plug-and-Play Engine System** - Add new TTS engines without touching backend code!
- **Complete Dependency Isolation** - Each engine runs in its own virtual environment
- **Database-Backed Job Queue** - Persistent job state survives backend restarts
- **Worker-Queue Pattern** - Background worker with graceful shutdown and recovery
- **Job Management** - Resume cancelled jobs, clear finished jobs, track progress

### Code Quality & Standards
- **100% Pydantic Compliance** - All API endpoints use validated response models

### User Experience
- **JobsPanel UI** - Centralized job management with status tracking
- **Queued Status** - Visual feedback for segments waiting in job queue
- **Segment Regeneration** - Improved workflow with safety warnings
- **Health Monitoring** - Real-time backend health status via SSE

## Technical Changes

### Backend

**Server-Sent Events:**
- EventBroadcaster service with channel-based routing (jobs, health, speakers, settings)
- 25 event types for real-time updates across all entities
- TTS Worker emits events during generation 
- Health broadcaster sends updates every 5s 

**Database & API:**
- Database migration: renamed columns to use `tts_` prefix consistently
- All endpoints use Pydantic response models with automatic camelCase conversion
- Job persistence in `tts_jobs` table (pending → running → completed/failed/cancelled)
- Segment cleanup on cancel/delete/crash (prevents orphaned segments)

**Engine Architecture:**
- Auto-discovery scans `backend/engines/` for new engines at backend startup
- Dynamic imports with optional `engine.yaml` metadata
- No hardcoded engine references in backend code

### Frontend

**React Query Optimizations:**
- SSE-aware polling with automatic fallback (30s interval)
- Increased cache times for static data (10m engines, 5m models)
- Optimized invalidations (chapter-specific instead of project-wide)

**Job Management:**
- JobsPanel component with status badges and progress tracking
- Resume cancelled jobs with one click
- Clear finished jobs (completed/failed/cancelled)
- Active job monitoring with SSE (no polling)

## Breaking Changes

### Database Schema
- Migration required: `engine` → `tts_engine`, `model_name` → `tts_model_name`, `speaker_name` → `tts_speaker_name`
- Automatic migration runs on first startup

### API Changes
- All responses now use camelCase (automatic conversion via Pydantic)
- Request bodies accept both snake_case and camelCase (backwards compatible)

## For Developers: Extending with Custom TTS Engines

**v0.2.0 introduces a new plug-and-play engine system!**

You can now add your own TTS engines to Audiobook Maker **without modifying backend code**:

### How Easy Is It?

1. **Copy the template:**
   ```bash
   cp -r backend/engines/_template backend/engines/my_engine
   ```

2. **Implement 3 methods** in `server.py`:
   - `load_model()` - Load your TTS model
   - `generate_audio()` - Synthesize text to audio
   - `unload_model()` - Free resources

3. **Configure** `engine.yaml`:
   - Name, languages, capabilities
   - Models are auto-discovered from `models/` folder

4. **Create isolated VENV:**
   ```bash
   cd backend/engines/my_engine
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   ```

5. **Restart backend** → Engine appears in UI automatically! ✅

### Supported TTS Engines

Out of the box:
- **XTTS v2** (voice cloning, 17+ languages)
- **Chatterbox Multilingual** (experimental)

**Want to add Piper? Coqui? Just implement the 3 methods!**

📖 **See [ENGINE_DEVELOPMENT_GUIDE.md](./docs/engine-development-guide.md) for complete documentation.**

---

## Known Issues

- SSE connection may disconnect on network changes (auto-reconnects within 3s)
- First SSE connection takes 100-200ms to establish

---

**Full Changelog**: https://github.com/DigiJoe79/audiobook-maker/compare/v0.1.0...v0.2.0

## Contributors

Built with Tauri 2.1, React 18, Python FastAPI, and powered by XTTS v2 for voice cloning.
