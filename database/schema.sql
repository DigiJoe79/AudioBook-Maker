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
    default_tts_engine TEXT NOT NULL,
    default_tts_model_name TEXT NOT NULL,
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

-- Global Settings Table
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL,
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

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id);
CREATE INDEX IF NOT EXISTS idx_segments_chapter ON segments(chapter_id);
CREATE INDEX IF NOT EXISTS idx_segments_order ON segments(chapter_id, order_index);
CREATE INDEX IF NOT EXISTS idx_segments_engine ON segments(tts_engine);
CREATE INDEX IF NOT EXISTS idx_segments_speaker ON segments(tts_speaker_name);
CREATE INDEX IF NOT EXISTS idx_segments_language ON segments(language);
CREATE INDEX IF NOT EXISTS idx_projects_order ON projects(order_index);
CREATE INDEX IF NOT EXISTS idx_segments_type ON segments(segment_type);
CREATE INDEX IF NOT EXISTS idx_tts_jobs_status ON tts_jobs(status);
CREATE INDEX IF NOT EXISTS idx_tts_jobs_chapter ON tts_jobs(chapter_id);
CREATE INDEX IF NOT EXISTS idx_tts_jobs_created ON tts_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_export_jobs_chapter ON export_jobs(chapter_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_speaker_samples_speaker ON speaker_samples(speaker_id);
CREATE INDEX IF NOT EXISTS idx_speakers_default ON speakers(is_default);
CREATE INDEX IF NOT EXISTS idx_speakers_active ON speakers(is_active);
