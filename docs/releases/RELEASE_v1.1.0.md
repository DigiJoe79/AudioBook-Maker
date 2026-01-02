# Release v1.1.0 - Docker-First Architecture & Online Engine Catalog

This release transforms Audiobook Maker into a **Docker-first application**. Engines are now distributed as prebuilt Docker images via the [audiobook-maker-engines](https://github.com/DigiJoe79/audiobook-maker-engines) repository, eliminating complex Python environment setup for end users.

## The Docker-First Vision

### For End Users: Zero-Setup Engines

**Before v1.1.0:** Installing a TTS engine like XTTS meant:
- Installing Python 3.10+
- Creating virtual environments
- Installing CUDA/cuDNN dependencies
- Downloading models manually
- Debugging dependency conflicts

**With v1.1.0:** Click "Install" in the UI:
- Prebuilt Docker images from GitHub Container Registry
- All dependencies bundled (Python, CUDA, models)
- One-click installation and updates
- Works on Windows, macOS, and Linux

### Online Engine Catalog

All engines are distributed via the **[audiobook-maker-engines](https://github.com/DigiJoe79/audiobook-maker-engines)** repository:

```
https://github.com/DigiJoe79/audiobook-maker-engines
├── catalog.yaml          # Engine metadata, versions, requirements
├── xtts/                 # XTTS v2 engine
│   └── Dockerfile
├── whisper/              # Whisper STT engine
│   └── Dockerfile
└── ...
```

**How it works:**
1. Backend syncs `catalog.yaml` on startup
2. UI shows available engines with version info
3. User clicks "Install" → pulls from `ghcr.io/digijoe79/audiobook-maker-engines`
4. Engine ready to use in seconds (depending on image size)
5. Update detection: compares local digest with registry

**Image Registry:** `ghcr.io/digijoe79/audiobook-maker-engines/{engine}:{tag}`

### For Developers: Subprocess Mode

Subprocess execution (LocalRunner) remains available for engine development:

- Clone the engines repo: `git clone https://github.com/DigiJoe79/audiobook-maker-engines backend/engines`
- Create VENV, install dependencies, iterate on code
- Test locally before building Docker images
- Backend auto-discovers engines in `backend/engines/`

**Use subprocess mode when:**
- Developing new engines
- Debugging engine code
- Contributing to audiobook-maker-engines

## Deployment Scenarios

### Recommended: Full Docker Stack

Run everything in Docker - backend and engines:

**Using docker compose:**
```bash
docker compose up -d
```

**Or standalone docker run:**
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

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    container_name: audiobook-maker-backend  # Required name (orphan cleanup)
    ports:
      - "8765:8765"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
      - ./media:/app/media
    environment:
      - DEFAULT_ENGINE_RUNNER=docker
      - DOCKER_ENGINE_HOST=host.docker.internal
```

> **Note:** The container must be named `audiobook-maker-backend`. On startup, the backend stops orphaned engine containers (prefix `audiobook-`) from previous sessions. Using a different name will cause the backend to stop itself.

### Remote GPU Offloading

Run GPU-intensive engines on a dedicated server:

```
┌─────────────────────┐         SSH         ┌─────────────────────┐
│   Your PC (CPU)     │◄──────────────────► │  GPU Server         │
│   - Tauri App       │                     │  - Docker           │
│   - Backend         │                     │  - NVIDIA Runtime   │
│   - Non-GPU engines │                     │  - XTTS, Whisper    │
└─────────────────────┘                     └─────────────────────┘
```

Features:
- SSH key auto-generation per host
- GPU detection (NVIDIA runtime check)
- Volume mounts for samples/models
- Per-host engine installation

### Developer Setup

For engine development, run backend in VENV:

```bash
cd backend
python -m venv venv
./venv/Scripts/activate  # Windows
pip install -r requirements.txt
python main.py
```

Then clone engines repo and develop locally.

## Engine Runner Architecture

Three runner types execute engines in different environments:

```
EngineRunner (ABC)
├── LocalRunner        - Subprocess in local VENV (developers)
├── DockerRunner       - Local Docker containers (recommended)
└── RemoteDockerRunner - Remote Docker via SSH (GPU offloading)
```

**Configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_ENGINE_RUNNER` | `local` | Default: `local` or `docker` |
| `DOCKER_ENGINE_HOST` | `127.0.0.1` | Backend address for containers |


## Engine Hosts Management UI

New "Engine Hosts" tab in Settings manages all execution environments:

| Host Type | Description |
|-----------|-------------|
| **Subprocess** | Built-in, for developers (VENV-based) |
| **Docker Local** | Local Docker daemon (recommended) |
| **Docker Remote** | Remote servers via SSH |

**Features:**
- Add/remove remote Docker hosts with SSH key wizard
- Test connection with GPU detection
- Volume configuration (samples, models paths)
- SSH public key display with copy-to-clipboard
- Per-host engine installation from online catalog
- Automatic image update detection

## REST API

### Engine Host Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/engine-hosts` | List all hosts |
| GET | `/engine-hosts/{id}` | Get specific host |
| POST | `/engine-hosts` | Create new host |
| DELETE | `/engine-hosts/{id}` | Delete host |
| POST | `/engine-hosts/{id}/test` | Test connection + GPU detection |
| POST | `/engine-hosts/prepare` | Generate SSH key for new host |
| GET | `/engine-hosts/{id}/volumes` | Get volume configuration |
| POST | `/engine-hosts/{id}/volumes` | Set volume configuration |
| GET | `/engine-hosts/{id}/public-key` | Get SSH public key for host |

### Engine/Catalog Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/engines/catalog/sync` | Sync online catalog |
| POST | `/engines/{variant}/install` | Install Docker engine |
| DELETE | `/engines/{variant}/uninstall` | Uninstall Docker engine |
| GET | `/engines/{variant}/check-update` | Check for image updates |
| POST | `/engines/{variant}/pull-update` | Pull latest image |

## Database Schema

New `engine_hosts` table:

```sql
CREATE TABLE engine_hosts (
    host_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    host_type TEXT NOT NULL,        -- 'subprocess' | 'docker:local' | 'docker:remote'
    ssh_url TEXT,                   -- For remote: ssh://user@host
    is_available INTEGER DEFAULT 1,
    has_gpu INTEGER,                -- NULL=unknown, 0=no, 1=yes
    samples_path TEXT,              -- Volume mount for samples
    models_path TEXT,               -- Volume mount for models
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

## Bug Fixes

### SQLite WAL Mode Disabled
Disabled WAL journal mode for Docker volume mount compatibility. Database uses DELETE mode for network filesystem support.


## Technical Details

### New Backend Modules

| Module | Description |
|--------|-------------|
| `core/engine_runner.py` | EngineRunner ABC + EngineEndpoint |
| `core/local_runner.py` | Subprocess runner (developer mode) |
| `core/docker_runner.py` | Local Docker runner |
| `core/remote_docker_runner.py` | SSH-based remote runner |
| `core/engine_runner_registry.py` | Central runner registry |
| `db/engine_host_repository.py` | Host CRUD operations |
| `api/engine_hosts.py` | Host REST API |
| `services/docker_service.py` | Docker SDK operations |
| `services/docker_discovery_service.py` | Catalog sync, discovery |
| `services/docker_host_monitor.py` | Host availability monitoring |
| `services/ssh_key_service.py` | SSH key management |
| `services/online_catalog_service.py` | Online catalog management |

### New Frontend Components

| Component | Description |
|-----------|-------------|
| `EngineHostsTab.tsx` | Main host management UI |
| `HostEnginesSection.tsx` | Per-host engine list |
| `HostSettingsDialog.tsx` | Volume config + SSH key |
| `AddHostDialog.tsx` | Add remote host wizard |
| `AddImageDialog.tsx` | Install from catalog |
| `useSSEDockerHostHandlers.ts` | Host status SSE events |

### New Dependencies

- `docker>=7.0.0` - Docker SDK for Python

### Tests

23 new tests covering:
- EngineRunner abstraction (3)
- LocalRunner (4)
- DockerRunner (3)
- RemoteDockerRunner (2)
- EngineRunnerRegistry (6)
- DockerHostRepository (3)
- BaseEngineManager integration (2)

## Migration Notes

- Existing VENV-based installations continue to work
- No database migration required
- Docker mode is opt-in via `DEFAULT_ENGINE_RUNNER=docker`
- Recommended: Switch to Docker for production use


---

**Full Changelog**: https://github.com/DigiJoe79/audiobook-maker/compare/v1.0.2...v1.1.0

**Engine Repository**: https://github.com/DigiJoe79/audiobook-maker-engines
