# Engine System Architecture

Technical documentation for the engine discovery, database integration, and configuration system.

## Overview

The audiobook-maker supports four engine types:
- **TTS** (Text-to-Speech): XTTS, Chatterbox, VibeVoice, Debug-TTS
- **STT** (Speech-to-Text): Whisper
- **Text Processing**: spaCy
- **Audio Analysis**: Silero-VAD

Engines can run as:
- **Subprocess**: Local Python process with dedicated VENV
- **Docker**: Containerized engine (pulled from registry)

## YAML Configuration Schema

Each engine is defined by an `engine.yaml` file with `schema_version: 2`:

```yaml
schema_version: 2

# IDENTITY (required)
name: "engine-name"           # Unique ID (lowercase, hyphens allowed)
display_name: "Engine Name"   # Human-readable name
engine_type: "tts"            # Required: "tts", "stt", "text", "audio"
description: "..."            # Optional description

# UPSTREAM (credits & license attribution)
upstream:
  name: "Original Project Name"
  url: "https://github.com/..."
  license: "MIT"

# DISTRIBUTION (Docker engines only)
variants:
  - tag: "latest"
    platforms: ["linux/amd64"]
    requires_gpu: true

# MODELS
models:
  - name: "model-id"
    display_name: "Model Name"
    # Additional model-specific fields allowed (size_mb, vram_gb, etc.)

default_model: "model-id"
auto_discover_models: false   # If true, scans models/ directory

# LANGUAGES
supported_languages:
  - en
  - de

# CONSTRAINTS (only actively used: max_text_length)
constraints:
  max_text_length: 250

# CAPABILITIES (only actively used: supports_model_hotswap)
capabilities:
  supports_model_hotswap: true

# UI PARAMETERS
parameters:
  temperature:
    type: "float"             # float, int, bool, string
    label: "i18n.key"
    description: "i18n.key"
    default: 0.65
    min: 0.0
    max: 1.0
    step: 0.05
    readonly: false
    category: "optional"

# ENGINE-SPECIFIC CONFIG
engine_config:
  device: "auto"
  # ... engine-specific settings

# INSTALLATION (subprocess engines)
installation:
  python_version: "3.10"
  venv_path: "./venv"
  requires_gpu: true
```

### Actively Used Fields

| Field | Used For |
|-------|----------|
| `constraints.max_text_length` | Text validation in `/generate` (returns 400 if exceeded) |
| `capabilities.supports_model_hotswap` | Model switching without restart |
| `capabilities.supports_speaker_cloning` | TTS: Requires speaker samples in `/generate` (returns 400 if missing) |
| `parameters.*` | UI settings panel |

Other constraint/capability fields are reserved for future use.

## Data Sources and Synchronization

### Three Discovery Paths

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         engine.yaml (Canonical Source)                      │
│  All engine metadata originates from engine.yaml files.                     │
│  The three paths below are different ways to consume this data.             │
└─────────────────────────────────────────────────────────────────────────────┘
                │                    │                     │
                ▼                    ▼                     ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────────┐
│   Local Discovery    │ │   Online Catalog     │ │   Custom Docker          │
│   (Subprocess)       │ │   (catalog.yaml)     │ │   (/info endpoint)       │
│                      │ │                      │ │                          │
│ Reads engine.yaml    │ │ Pre-built from       │ │ Returns engine.yaml      │
│ from filesystem      │ │ engine.yaml at       │ │ content via HTTP         │
│ at backend startup   │ │ release time         │ │ on user request          │
└──────────┬───────────┘ └──────────┬───────────┘ └────────────┬─────────────┘
           │                        │                          │
           │                        ▼                          │
           │             ┌──────────────────────┐              │
           │             │ docker_image_catalog │              │
           │             │ (Template Storage)   │              │
           │             └──────────┬───────────┘              │
           │                        │                          │
           │                        │ Install on Host          │
           ▼                        ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         engines (Instance Storage)                          │
│  Single Source of Truth for installed/configured engines                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Path | Source | Intermediate | Target | Trigger |
|------|--------|--------------|--------|---------|
| **Local (Subprocess)** | engine.yaml | - | engines | Backend startup |
| **Online Catalog** | catalog.yaml | docker_image_catalog | engines | Sync + Install |
| **Custom Docker** | /info endpoint | - | engines | User action |

### Canonical Field Names

**All sources use `snake_case`** - no transformation needed between layers.

| Field (Internal) | engine.yaml | catalog.yaml | /info endpoint | DB Column |
|------------------|-------------|--------------|----------------|-----------|
| `name` | `name` | `name` | `name` | `base_engine_name` |
| `display_name` | `display_name` | `display_name` | `displayName`* | `display_name` |
| `engine_type` | `engine_type` | `engine_type` | `engineType`* | `engine_type` |
| `supported_languages` | `supported_languages` | `supported_languages` | `supportedLanguages`* | `supported_languages` |
| `constraints` | `constraints` | `constraints` | `constraints` | `constraints` |
| `capabilities` | `capabilities` | `capabilities` | `capabilities` | `capabilities` |
| `parameters` | `parameters` | `parameters` | `parameters` | `parameters` |
| `models` | `models` | `models` | `models` | (engine_models table) |
| `default_model` | `default_model` | `default_model` | `defaultModel`* | (engine_models.is_default) |
| `requires_gpu` | `installation.requires_gpu` | `variants[].requires_gpu` | `requiresGpu`* | `requires_gpu` |

*\* /info endpoint uses CamelCaseModel which converts top-level field names to camelCase. Dict contents remain snake_case.*

### Dict Content Convention (Consumer-First)

`CamelCaseModel` only converts **top-level field names**, not contents of `Dict[str, Any]` fields.

Following the **Consumer-First Principle** (see coding-standards), dict contents are stored in **snake_case** because the **backend is the primary consumer**:

| Dict Field | Primary Consumer | Convention | Reason |
|------------|------------------|------------|--------|
| `constraints` | Backend (segmentation, validation) | snake_case | `max_text_length` used in tts_worker, segment_validator |
| `capabilities` | Backend (engine logic) | snake_case | `supports_model_hotswap` used in base_engine_manager |
| `parameters` | Backend → Engine Server | snake_case | Passed directly to engine servers |

```
DB Column (snake_case)     JSON Content (snake_case)
─────────────────────────────────────────────────────
constraints          →     {"max_text_length": 300}
capabilities         →     {"supports_model_hotswap": true, "supports_speaker_cloning": true}
parameters           →     {"temperature": {"type": "float", "default": 0.8, ...}}
```

**Frontend Compatibility:**
Per coding-standards, frontend **MUST accept snake_case** for engine-related dicts:
```typescript
// Frontend types for engine data
interface EngineConstraints {
    max_text_length?: number          // snake_case from backend
    max_text_length_by_lang?: Record<string, number>
}
```

**Conversion Rules:**

| Source | Transformation | Target |
|--------|----------------|--------|
| `engine.yaml` | None (already snake_case) | DB |
| `catalog.yaml` | None (already snake_case) | DB |
| `/info` endpoint | None (Dict contents already snake_case) | DB |
| DB | None (frontend accepts snake_case) | API Response |

**Implementation:**
- `base_engine_discovery.py`: Stores engine.yaml contents as-is (snake_case)
- `online_catalog_service.py`: Stores catalog.yaml contents as-is (snake_case)
- `docker_discovery_service.py`: Stores /info Dict contents as-is (snake_case)

## Database Schema

### `engines` Table

Single source of truth for all **installed/configured** engine instances:

```sql
CREATE TABLE engines (
    variant_id TEXT PRIMARY KEY,      -- e.g., "xtts:local", "xtts:docker:local"
    base_engine_name TEXT,            -- e.g., "xtts"
    engine_type TEXT,                 -- "tts", "stt", "text", "audio"
    host_id TEXT,                     -- "local" or "docker:local" or "docker:remote:name"
    source TEXT,                      -- "local", "catalog", "custom"

    -- Installation status
    is_installed BOOLEAN DEFAULT FALSE,
    installed_at TEXT,

    -- User settings (preserved across updates)
    is_default BOOLEAN DEFAULT FALSE,
    enabled BOOLEAN DEFAULT FALSE,
    keep_running BOOLEAN DEFAULT FALSE,
    default_language TEXT,
    parameters TEXT,                  -- JSON: user-modified values

    -- System metadata (updated from source)
    display_name TEXT,
    supported_languages TEXT,         -- JSON array
    constraints TEXT,                 -- JSON
    capabilities TEXT,                -- JSON
    config TEXT,                      -- Full engine.yaml content as JSON
    config_hash TEXT,                 -- SHA256 hash for change detection

    -- Paths (subprocess only, source="local")
    venv_path TEXT,
    server_script TEXT,

    -- Docker (source="catalog" or "custom")
    docker_image TEXT,
    docker_tag TEXT,

    requires_gpu BOOLEAN DEFAULT FALSE,
    created_at TEXT,
    updated_at TEXT
);
```

#### Source Values

| source | Description | Update Behavior |
|--------|-------------|-----------------|
| `local` | Subprocess engine from `backend/engines/` | Updated from engine.yaml at startup |
| `catalog` | Installed from online catalog | System metadata updated on catalog sync |
| `custom` | User-added Docker image | Never auto-updated (user-controlled) |

### `engine_models` Table

Normalized model storage:

```sql
CREATE TABLE engine_models (
    id TEXT PRIMARY KEY,
    variant_id TEXT,                  -- FK to engines
    engine_model_name TEXT,
    display_name TEXT,
    is_default BOOLEAN DEFAULT FALSE, -- Default model for this variant
    is_available BOOLEAN DEFAULT TRUE,
    source TEXT,                      -- "yaml", "discovered", "docker"
    metadata TEXT,                    -- JSON: size_mb, vram_gb, etc.
    created_at TEXT
);
```

**Note:** `is_default` in `engine_models` is the single source of truth for default model selection (moved from `engines.default_model_name` in migration 012).

### `docker_image_catalog` Table

Template storage for available Docker images (host-independent):

```sql
CREATE TABLE docker_image_catalog (
    id INTEGER PRIMARY KEY,
    base_engine_name TEXT UNIQUE,     -- e.g., "chatterbox" (matches engines.base_engine_name)
    image_name TEXT,                  -- e.g., "ghcr.io/digijoe79/audiobook-maker-engines/chatterbox"
    engine_type TEXT,                 -- "tts", "stt", "text", "audio"
    display_name TEXT,
    description TEXT,                 -- Engine description
    requires_gpu BOOLEAN DEFAULT FALSE,

    -- Docker distribution
    default_tag TEXT DEFAULT 'latest',
    tags TEXT,                        -- JSON array: ["latest", "v1.0", "cuda"]

    -- Engine metadata (same structure as engines table)
    supported_languages TEXT,         -- JSON array
    constraints TEXT,                 -- JSON
    capabilities TEXT,                -- JSON
    parameters TEXT,                  -- JSON: full parameter schema (type, min, max, default, etc.)

    -- Models
    models TEXT,                      -- JSON array: [{name, displayName, ...}]
    default_model TEXT,

    -- Provenance
    source TEXT DEFAULT 'online',     -- "builtin", "online", "custom"
    repo_url TEXT,                    -- Upstream repository URL
    catalog_version TEXT,             -- Version from catalog.yaml

    created_at TEXT,
    updated_at TEXT
);
```

#### Relationship: docker_image_catalog → engines

```
docker_image_catalog (Templates)          engines (Instances)
┌─────────────────────────────┐           ┌─────────────────────────────┐
│ base_engine_name: chatterbox│           │ variant_id: chatterbox:     │
│ image_name: ghcr.io/.../... │──Install──│             docker:local    │
│ display_name: Chatterbox    │  on Host  │ base_engine_name: chatterbox│
│ constraints: {...}          │           │ host_id: docker:local       │
│ capabilities: {...}         │           │ is_installed: true          │
│ parameters: {...}           │           │ (metadata copied from       │
│ models: [...]               │           │  catalog at install time)   │
└─────────────────────────────┘           └─────────────────────────────┘
         │
         │ Same template can be installed on multiple hosts:
         │
         ├──Install on docker:local ──────► chatterbox:docker:local
         ├──Install on docker:gpu-server ─► chatterbox:docker:gpu-server
         └──Install on docker:cloud ──────► chatterbox:docker:cloud
```

## Discovery Process

### Startup Flow

Engine registration happens in `main.py` during async startup:

```
1. manager.discover_local_engines()
   └── Scan engines/{type}/ directories
   └── Parse & validate engine.yaml (Pydantic schema)
   └── Calculate config_hash (SHA256 of YAML content)
   └── Check VENV existence → sets is_installed flag
   └── Returns Dict[engine_name, metadata] (no RAM storage)

2. manager._register_local_engines_in_db(discovered)
   └── For each discovered engine:
       ├── NEW: Insert with config_hash
       ├── REINSTALLED (is_installed: 0→1): Update metadata + auto-enable
       ├── CONFIG CHANGED (hash differs): Update system metadata
       └── UNCHANGED: Skip

3. manager._sync_uninstalled_engines()
   └── Check DB engines where VENV no longer exists
   └── Mark as is_installed=false

4. Model Discovery (for enabled engines without models)
   └── Start engine (no model load)
   └── Query /models endpoint
   └── Store models in engine_models table
   └── Set first model as default
   └── Stop engine
```

**Note:** There is no `_engine_metadata` RAM cache. The database is the Single Source of Truth (SSOT). All lookups use `get_engine_metadata()` which reads from database.

### Enable/Disable Model Handling

When engines are enabled/disabled via API:

**Enable (`POST /engines/{type}/{name}/enable`):**
- If no models exist in `engine_models` for this variant:
  - Start engine → Query `/models` → Store in DB → Stop engine
  - First discovered model is set as default

**Disable (`POST /engines/{type}/{name}/disable`):**
- All models for this variant are removed from `engine_models` table
- Engine is stopped if running

### Update Scenarios

| Scenario | Trigger | DB Action |
|----------|---------|-----------|
| New engine | Not in DB | INSERT all fields |
| Reinstalled | `is_installed: 0→1` | UPDATE system metadata + reset parameters |
| Config changed | `config_hash` differs | UPDATE system metadata + reset parameters |
| Uninstalled | VENV deleted | SET `is_installed=false` |
| Unchanged | Hash matches | No changes |

### Auto-Enable Logic

When an engine becomes installed and no other engine of that type is enabled:
- `enabled = true`
- `is_default = true`

This ensures first-time users have a working default without manual configuration.

## Field Categories

### System-Controlled (updated from YAML)
- `display_name`
- `supported_languages`
- `constraints`
- `capabilities`
- `config`
- `config_hash`
- `parameters` (reset to defaults on config change)

### User-Controlled (never overwritten)
- `enabled`
- `is_default`
- `keep_running`
- `default_language`

### Model Data (in `engine_models` table)
- `is_default` - Default model per variant (SSOT)

## Engine Lifecycle States

```
           ┌─────────────────────────────────────┐
           │                                     │
           ▼                                     │
    ┌──────────┐     install      ┌──────────┐  │
    │ disabled │ ───────────────► │ stopped  │  │
    │ (YAML    │                  │ (VENV    │  │
    │  only)   │                  │  exists) │  │
    └──────────┘                  └────┬─────┘  │
           ▲                           │        │
           │ uninstall                 │ start  │
           │ (delete VENV)             ▼        │
           │                     ┌──────────┐   │
           │                     │ starting │   │
           │                     └────┬─────┘   │
           │                          │         │
           │                          ▼         │
           │                     ┌──────────┐   │
           │                     │ running  │ ──┘
           │                     └────┬─────┘   stop
           │                          │
           │                          ▼
           │                     ┌──────────┐
           └──────────────────── │ stopping │
                                 └──────────┘
```

## API Integration

### Getting Engine Metadata

```python
from core.tts_engine_manager import get_tts_engine_manager

manager = get_tts_engine_manager()

# Get from DB (single source of truth)
metadata = manager.get_engine_metadata("xtts:local")

# Returns dict with:
# - name, display_name, supported_languages
# - constraints, capabilities, config
# - is_installed, enabled, is_default
# - venv_path, server_script (subprocess)
# - docker_image, docker_tag (Docker)
```

### Checking Installation Status

```python
from db.engine_repository import EngineRepository

repo = EngineRepository(conn)

# All installed engines
installed = repo.get_installed("tts")

# All enabled engines
enabled = repo.get_enabled("tts")
```

## Adding a New Engine

### Subprocess Engine (Local Development)

1. Create directory: `backend/engines/{type}/{engine-name}/`
2. Add `engine.yaml` with schema_version 2
3. Add `server.py` (inherit from base server class)
4. Run `setup.bat` to create VENV
5. Restart backend -> auto-discovered and registered

See [engine-development-guide.md](engine-development-guide.md) for detailed instructions.

### Docker Engine (Production)

Docker engines are maintained in a separate repository: [audiobook-maker-engines](https://github.com/DigiJoe79/audiobook-maker-engines)

Key documentation in that repo:
- `CLAUDE.md` - Quick reference for engine creation
- `docs/model-management.md` - Model Management Standard (required reading)

**Model Management Pattern:**

All Docker engines follow a unified model management pattern:

```
/app/                          # Container root
+-- models/                    # Server reads from here (baked-in + symlinks)
+-- external_models/           # Mount point for external models
+-- samples/                   # Speaker samples for voice cloning
```

- **Baked-in models:** Copied during Docker build, take precedence
- **External models:** Mounted at runtime, symlinked to `models/` by entrypoint
- **On-demand downloads:** Go to `external_models/` for persistence

See the engines repo documentation for the complete conformance checklist.

## Docker Discovery (Manual)

Custom Docker engines can be added manually by the user. The engine exposes its metadata via the `/info` endpoint, which the app queries during discovery.

### `/info` Endpoint

All engine servers expose a `/info` endpoint (implemented in `base_server.py`) that returns the complete engine.yaml content as JSON:

```python
# base_server.py
@self.app.get("/info", response_model=EngineInfoResponse)
async def info_endpoint():
    """Static engine metadata from engine.yaml"""
    return EngineInfoResponse(
        name=self.engine_name,
        display_name=self.display_name,
        engine_type=self.engine_type,
        supported_languages=self.supported_languages,
        constraints=self.constraints,
        capabilities=self.capabilities,
        parameters=self.parameters_schema,
        models=self.models,
        default_model=self.default_model,
        upstream=self.upstream,
    )
```

**Response Schema:**

```json
{
  "name": "my-custom-tts",
  "displayName": "My Custom TTS",
  "engineType": "tts",
  "supportedLanguages": ["en", "de"],
  "constraints": { "maxTextLength": 500 },
  "capabilities": { "supportsModelHotswap": true },
  "parameters": { ... },
  "models": [ ... ],
  "defaultModel": "default",
  "upstream": { "name": "...", "url": "...", "license": "..." }
}
```

### Pydantic Validation

The `/info` response is validated against `EngineYamlSchema` in `models/engine_schema.py`. This is the same schema used for validating `engine.yaml` files during subprocess discovery at backend startup.

**Required fields:**
- `name` - Engine identifier (lowercase, hyphens allowed)
- `display_name` - Human-readable name
- `engine_type` - One of: `"tts"`, `"stt"`, `"text"`, `"audio"`
- `schema_version` - Currently `2`

**Validation example:**

```python
from models.engine_schema import validate_yaml_dict

# Validate /info response
info_response = httpx.get(f"http://localhost:{port}/info").json()
validated = validate_yaml_dict(info_response)  # Raises ValidationError if invalid
```

### Discovery Flow

```
1. User provides Docker image (local or remote)
   ├── Local: "my-tts:latest" (already built)
   └── Remote: "ghcr.io/user/my-tts:cuda"

2. App starts container temporarily
   └── docker run -d -p {port}:8000 {image}

3. App queries /info endpoint
   └── GET http://localhost:{port}/info
   └── Returns engine.yaml as JSON

4. App shows confirmation dialog
   └── Pre-filled form with discovered metadata
   └── User can edit display_name, etc.
   └── User confirms

5. App registers engine in database
   └── INSERT INTO engines (variant_id, base_engine_name, engine_type, ...)
   └── variant_id: "{name}:docker:local" (e.g., "my-tts:docker:local")
   └── source: "custom" (protected from catalog updates)

6. App stops temporary container
   └── Engine now available in UI
```

### User Input Requirements

| Field | Source | Required |
|-------|--------|----------|
| `docker_image` | User input | Yes |
| `docker_tag` | User input (default: "latest") | Yes |
| All other fields | Discovered via `/info` | Automatic |

### Database Registration

Custom Docker engines are stored in the `engines` table with:

| Column | Value |
|--------|-------|
| `variant_id` | `{name}:docker:local` |
| `host_id` | `docker:local` |
| `docker_image` | User-provided image name |
| `docker_tag` | User-provided tag |
| `source` | `custom` |

**Important:** Engines with `source: custom` are **never overwritten** by online catalog updates. They persist until manually deleted by the user.

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Container fails to start | Show error, suggest checking image name/GPU requirements |
| `/info` returns 404 | Engine doesn't support discovery; show manual form |
| `/info` returns invalid data | Show partial form, user fills missing fields |
| Port conflict | Retry with different port |
| Timeout (30s) | Cancel discovery, show error |

## Online Catalog System

The online catalog provides pre-built Docker images from the `audiobook-maker-engines` repository.

### catalog.yaml Specification

Generated from engine.yaml files during GitHub Release. Uses **snake_case** throughout (same as engine.yaml):

```yaml
catalog_version: "1.0"
min_app_version: "1.1.0"
registry: "ghcr.io/digijoe79/audiobook-maker-engines"
last_updated: "2025-12-14T09:54:40Z"

engines:
  - name: "chatterbox"
    engine_type: "tts"
    display_name: "Chatterbox"
    description: "Resemble AI - Chatterbox TTS, SoTA open-source TTS"

    upstream:
      name: "Resemble AI - Chatterbox TTS"
      url: "https://github.com/resemble-ai/chatterbox"
      license: "MIT"

    variants:
      - tag: "latest"
        platforms: ["linux/amd64"]
        requires_gpu: true

    supported_languages: ["de", "en", "fr", "es", ...]

    constraints:
      max_text_length: 300

    capabilities:
      supports_model_hotswap: false
      supports_speaker_cloning: true
      supports_streaming: false

    parameters:
      temperature:
        type: "float"
        label: "settings.tts.chatterbox.temperature"
        description: "settings.tts.chatterbox.temperatureDesc"
        default: 0.8
        min: 0.05
        max: 5.0
        step: 0.05
        readonly: false

    models:
      - name: "multilingual"
        display_name: "Multilingual (Pretrained)"

    default_model: "multilingual"
```

**Note:** catalog.yaml uses the same snake_case convention as engine.yaml. No transformation needed - the `generate_catalog.py` script simply aggregates engine.yaml files into a single catalog.

### Catalog Sync Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GitHub Release                                      │
│  audiobook-maker-engines/releases/latest/download/catalog.yaml             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ fetch (startup or manual refresh)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      online_catalog_service.py                              │
│  1. Fetch catalog.yaml from GitHub                                          │
│  2. Parse YAML (already snake_case, no transformation needed)               │
│  3. For each engine in catalog:                                             │
│     - UPSERT into docker_image_catalog (source='online')                    │
│     - Skip if source='custom' (user-defined, never overwrite)               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      docker_image_catalog                                   │
│  Templates ready for installation on any Docker host                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Installation Flow (Catalog → engines)

When user clicks "Install" for a catalog engine on a specific host:

```
1. User selects engine + host + tag
   └── e.g., "chatterbox" on "docker:local" with tag "latest"

2. docker pull {image}:{tag}
   └── ghcr.io/digijoe79/audiobook-maker-engines/chatterbox:latest

3. Copy metadata from docker_image_catalog → engines
   └── All system metadata (constraints, capabilities, parameters, models)
   └── Set source='catalog', is_installed=true

4. Engine ready to use
   └── No container startup needed for discovery
   └── Metadata already complete from catalog
```

**Code pattern:**

```python
def install_from_catalog(base_engine_name: str, host_id: str, tag: str):
    # Get template
    template = catalog_repo.get_by_engine_name(base_engine_name)

    # Create instance
    variant_id = f"{base_engine_name}:docker:{host_id}"

    engine_repo.upsert(
        variant_id=variant_id,
        base_engine_name=base_engine_name,
        engine_type=template["engine_type"],
        host_id=f"docker:{host_id}",
        source="catalog",
        is_installed=True,

        # Copy all metadata from template
        display_name=template["display_name"],
        supported_languages=template["supported_languages"],
        constraints=template["constraints"],
        capabilities=template["capabilities"],
        parameters=template["parameters"],
        requires_gpu=template["requires_gpu"],

        # Docker-specific
        docker_image=template["image_name"],
        docker_tag=tag,
    )

    # Copy models to engine_models table
    for model in template["models"]:
        model_repo.add_model(
            variant_id=variant_id,
            model_name=model["name"],
            model_info=model,
            is_default=(model["name"] == template["default_model"])
        )
```

### Catalog Update Sync

When catalog.yaml is refreshed, already-installed engines need metadata updates:

```python
def sync_installed_engines_from_catalog():
    """Update installed catalog engines with latest metadata."""

    for engine in engine_repo.get_by_source("catalog"):
        template = catalog_repo.get_by_engine_name(engine["base_engine_name"])

        if not template:
            continue  # Engine removed from catalog, keep local copy

        # Update ONLY system metadata, preserve user settings
        engine_repo.update_system_metadata(
            variant_id=engine["variant_id"],
            display_name=template["display_name"],
            supported_languages=template["supported_languages"],
            constraints=template["constraints"],
            capabilities=template["capabilities"],
            # Note: parameters NOT updated to preserve user customizations
        )
```

| Field Category | Updated on Sync? |
|----------------|------------------|
| `display_name` | Yes |
| `supported_languages` | Yes |
| `constraints` | Yes |
| `capabilities` | Yes |
| `parameters` | No (preserve user values) |
| `enabled` | No (user setting) |
| `is_default` | No (user setting) |
| `keep_running` | No (user setting) |
| `default_language` | No (user setting) |

## Engine Server API

For detailed documentation on the engine server API (endpoints, validation, error handling), see:

**[audiobook-maker-engines/docs/engine-server-api.md](https://github.com/DigiJoe79/audiobook-maker-engines/blob/main/docs/engine-server-api.md)**

Key topics covered there:
- Base server hierarchy and centralized features
- Common endpoints (`/health`, `/models`, `/load`, `/shutdown`, `/info`)
- Non-blocking operations and ThreadPoolExecutor
- Model hotswap
- Type-specific endpoints (TTS, Quality, Text)
- Input validation and error handling patterns
- Logging levels
