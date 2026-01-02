-- SQLite Database Schema for Audiobook Maker

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    order_index INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Chapters Table
CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Segments Table
CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    text TEXT NOT NULL,
    tts_engine TEXT NOT NULL,
    tts_model_name TEXT NOT NULL,
    tts_speaker_name TEXT,
    language TEXT NOT NULL,
    segment_type TEXT DEFAULT 'standard',
    pause_duration INTEGER DEFAULT 0,
    audio_path TEXT,
    order_index INTEGER NOT NULL,
    start_time REAL DEFAULT 0.0,
    end_time REAL DEFAULT 0.0,
    status TEXT DEFAULT 'pending', -- pending, queued, processing, completed, failed
    regenerate_attempts INTEGER DEFAULT 0, -- Auto-regenerate counter for quality defects
    is_frozen BOOLEAN DEFAULT FALSE, -- Frozen segments are protected from regeneration
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- TTS Jobs Table (for persistent job queue)
CREATE TABLE IF NOT EXISTS tts_jobs (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,

    -- Engine Configuration
    tts_engine TEXT NOT NULL,
    tts_model_name TEXT NOT NULL,
    tts_speaker_name TEXT NOT NULL,
    language TEXT NOT NULL,
    force_regenerate BOOLEAN DEFAULT FALSE,
    segment_ids TEXT, -- JSON array of segment IDs (for segment/selection jobs)

    -- Job Status & Progress
    status TEXT NOT NULL DEFAULT 'pending', -- pending, running, cancelling, cancelled, completed, failed
    total_segments INTEGER NOT NULL,
    processed_segments INTEGER DEFAULT 0,
    failed_segments INTEGER DEFAULT 0,
    current_segment_id TEXT,

    -- Error Handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- Export Jobs Table
CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, cancelled
    output_format TEXT NOT NULL, -- mp3, wav, m4a
    output_path TEXT, -- final file path or URL
    bitrate TEXT, -- 128k, 192k, 256k, 320k (null for WAV)
    sample_rate INTEGER DEFAULT 24000,
    pause_between_segments INTEGER DEFAULT 500, -- milliseconds
    total_segments INTEGER NOT NULL,
    merged_segments INTEGER DEFAULT 0, -- for progress tracking
    file_size INTEGER, -- bytes
    duration REAL, -- seconds
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- Quality Jobs Table (for audio quality analysis)
CREATE TABLE IF NOT EXISTS quality_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',

    -- Engine configuration
    stt_engine TEXT,
    stt_model_name TEXT,
    audio_engine TEXT,

    -- Context
    chapter_id TEXT,
    segment_id TEXT,
    language TEXT DEFAULT 'en',

    -- Segment tracking (like TTS jobs)
    segment_ids TEXT,

    -- Progress
    total_segments INTEGER DEFAULT 0,
    processed_segments INTEGER DEFAULT 0,
    failed_segments INTEGER DEFAULT 0,
    current_segment_id TEXT,

    -- Metadata
    trigger_source TEXT DEFAULT 'manual',
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- Pronunciation Rules Table (language-specific text transformations)
CREATE TABLE IF NOT EXISTS pronunciation_rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    replacement TEXT NOT NULL,
    is_regex BOOLEAN DEFAULT FALSE,
    scope TEXT NOT NULL CHECK (scope IN ('project_engine', 'engine', 'global')),
    project_id TEXT,
    engine_name TEXT NOT NULL,
    language TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(pattern, engine_name, language, project_id)
);

-- Segments Analysis Table (quality analysis results in generic format)
CREATE TABLE IF NOT EXISTS segments_analysis (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,

    -- Quality Analysis Results (generic format)
    quality_score INTEGER, -- Aggregated quality score (0-100)
    quality_status TEXT DEFAULT 'perfect' CHECK(quality_status IN ('perfect', 'warning', 'defect')),
    engine_results TEXT, -- JSON array of engine results in generic format

    -- Timestamps
    analyzed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    UNIQUE(segment_id)
);

-- Global Settings Table
-- NOTE: value must be TEXT (not JSON) to prevent SQLite auto-parsing
-- All values are stored as JSON-encoded strings via json.dumps()
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Speakers Table
CREATE TABLE IF NOT EXISTS speakers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    gender TEXT CHECK(gender IN ('male', 'female', 'neutral')),
    languages JSON, -- Array: ['de', 'en', 'fr']
    tags JSON,      -- Array: ['jung', 'freundlich', 'ernst']
    is_active BOOLEAN DEFAULT FALSE, -- Automatically set based on sample count
    is_default BOOLEAN DEFAULT FALSE, -- Only one speaker can be default
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Speaker Samples Table
CREATE TABLE IF NOT EXISTS speaker_samples (
    id TEXT PRIMARY KEY,
    speaker_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size INTEGER,
    duration REAL,
    sample_rate INTEGER,
    transcript TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE
);

-- ============================================================================
-- Engine System Tables (v1.1.0+)
-- ============================================================================

-- Engine Hosts Table (Docker/Remote hosts)
CREATE TABLE IF NOT EXISTS engine_hosts (
    host_id TEXT PRIMARY KEY,
    host_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    ssh_url TEXT,
    is_available BOOLEAN DEFAULT TRUE,
    has_gpu BOOLEAN DEFAULT NULL,
    last_checked_at TEXT,
    docker_volumes TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default engine host (subprocess)
-- Note: docker:local is added by migration with OS-specific URL
INSERT OR IGNORE INTO engine_hosts (host_id, host_type, display_name)
VALUES ('local', 'subprocess', 'Local Machine');

-- Docker Image Catalog (available images from online catalog)
CREATE TABLE IF NOT EXISTS docker_image_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_engine_name TEXT NOT NULL,
    image_name TEXT NOT NULL,
    engine_type TEXT NOT NULL,
    display_name TEXT,
    description TEXT DEFAULT '',
    requires_gpu BOOLEAN DEFAULT FALSE,
    default_tag TEXT DEFAULT 'latest',
    tags TEXT,
    supported_languages TEXT,
    constraints TEXT DEFAULT '{}',
    capabilities TEXT DEFAULT '{}',
    parameters TEXT DEFAULT '{}',
    models TEXT DEFAULT '[]',
    default_model TEXT DEFAULT '',
    catalog_version TEXT DEFAULT '',
    source TEXT DEFAULT 'builtin',
    repo_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(base_engine_name, image_name)
);

-- Engines Table (Single Source of Truth for all engine variants)
CREATE TABLE IF NOT EXISTS engines (
    variant_id TEXT PRIMARY KEY,
    base_engine_name TEXT NOT NULL,
    engine_type TEXT NOT NULL,
    host_id TEXT NOT NULL,
    source TEXT DEFAULT 'local',
    is_installed BOOLEAN DEFAULT FALSE,
    installed_at TEXT,
    display_name TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    enabled BOOLEAN DEFAULT FALSE,
    keep_running BOOLEAN DEFAULT FALSE,
    default_language TEXT,
    parameters TEXT,
    supported_languages TEXT,
    requires_gpu BOOLEAN DEFAULT FALSE,
    constraints TEXT,
    capabilities TEXT,
    config TEXT,
    config_hash TEXT,
    venv_path TEXT,
    server_script TEXT,
    docker_image TEXT,
    docker_tag TEXT DEFAULT 'latest',
    is_pulling BOOLEAN DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (host_id) REFERENCES engine_hosts(host_id)
);

-- Engine Models Table (discovered models per engine)
CREATE TABLE IF NOT EXISTS engine_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    model_info TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_available INTEGER NOT NULL DEFAULT 1,
    source TEXT DEFAULT 'discovered',
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(variant_id, model_name),
    FOREIGN KEY (variant_id) REFERENCES engines(variant_id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id);
CREATE INDEX IF NOT EXISTS idx_segments_chapter ON segments(chapter_id);
CREATE INDEX IF NOT EXISTS idx_segments_order ON segments(chapter_id, order_index);
CREATE INDEX IF NOT EXISTS idx_segments_engine ON segments(tts_engine);
CREATE INDEX IF NOT EXISTS idx_segments_speaker ON segments(tts_speaker_name);
CREATE INDEX IF NOT EXISTS idx_segments_language ON segments(language);
CREATE INDEX IF NOT EXISTS idx_projects_order ON projects(order_index);
CREATE INDEX IF NOT EXISTS idx_segments_type ON segments(segment_type);
CREATE INDEX IF NOT EXISTS idx_segments_frozen ON segments(is_frozen);
CREATE INDEX IF NOT EXISTS idx_tts_jobs_status ON tts_jobs(status);
CREATE INDEX IF NOT EXISTS idx_tts_jobs_chapter ON tts_jobs(chapter_id);
CREATE INDEX IF NOT EXISTS idx_tts_jobs_created ON tts_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_export_jobs_chapter ON export_jobs(chapter_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_quality_jobs_status ON quality_jobs(status);
CREATE INDEX IF NOT EXISTS idx_quality_jobs_chapter ON quality_jobs(chapter_id);
CREATE INDEX IF NOT EXISTS idx_quality_jobs_created ON quality_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_pronunciation_rules_engine ON pronunciation_rules(engine_name, language);
CREATE INDEX IF NOT EXISTS idx_pronunciation_rules_project ON pronunciation_rules(project_id);
CREATE INDEX IF NOT EXISTS idx_pronunciation_rules_scope ON pronunciation_rules(scope);
CREATE INDEX IF NOT EXISTS idx_segments_analysis_segment ON segments_analysis(segment_id);
CREATE INDEX IF NOT EXISTS idx_segments_analysis_chapter ON segments_analysis(chapter_id);
CREATE INDEX IF NOT EXISTS idx_segments_analysis_quality_status ON segments_analysis(quality_status);
CREATE INDEX IF NOT EXISTS idx_segments_analysis_quality_score ON segments_analysis(quality_score);
CREATE INDEX IF NOT EXISTS idx_speaker_samples_speaker ON speaker_samples(speaker_id);
CREATE INDEX IF NOT EXISTS idx_speakers_default ON speakers(is_default);
CREATE INDEX IF NOT EXISTS idx_speakers_active ON speakers(is_active);

-- Engine System Indexes (v1.1.0+)
CREATE UNIQUE INDEX IF NOT EXISTS idx_engines_default_per_type ON engines(engine_type) WHERE is_default = TRUE;
CREATE INDEX IF NOT EXISTS idx_engines_type ON engines(engine_type);
CREATE INDEX IF NOT EXISTS idx_engines_host ON engines(host_id);
CREATE INDEX IF NOT EXISTS idx_engines_installed ON engines(is_installed);
CREATE INDEX IF NOT EXISTS idx_engines_enabled ON engines(enabled);
CREATE INDEX IF NOT EXISTS idx_engine_models_variant ON engine_models(variant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_models_default_per_variant ON engine_models(variant_id) WHERE is_default = 1;
