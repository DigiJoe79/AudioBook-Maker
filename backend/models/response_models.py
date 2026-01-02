"""
Response Models with Automatic camelCase Conversion

This module provides Pydantic response models for FastAPI endpoints with automatic
snake_case (Python) to camelCase (JSON) conversion for frontend compatibility.

IMPORTANT FOR AI ASSISTANTS:
- ALL API responses MUST use these Pydantic models
- NEVER return raw dicts from repositories without response_model
- ALWAYS use response_model=XxxResponse in FastAPI endpoints
- This ensures consistent snake_case (Python) → camelCase (JSON) conversion

Example:
    @router.get("/segments/{id}", response_model=SegmentResponse)
    async def get_segment(id: str):
        segment = segment_repo.get_by_id(id)  # Returns dict with snake_case
        return segment  # Pydantic auto-converts to camelCase in JSON

Data Flow:
    Database (snake_case)
        ↓
    Repository Layer (snake_case dict)
        ↓
    Pydantic Response Model (validates + converts)
        ↓
    JSON Response (camelCase)
        ↓
    Frontend TypeScript (camelCase)
"""

from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any, Literal

# NOTE: This function is intentionally duplicated in backend/engines/base_server.py
# because engine servers run in isolated VENVs and need their own copy.
def to_camel(string: str) -> str:
    """
    Convert snake_case string to camelCase.

    Examples:
        speaker_name → speakerName
        created_at → createdAt
        chapter_id → chapterId
    """
    components = string.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])


def convert_dict_keys_to_camel(data):
    """
    Recursively convert all dict keys from snake_case to camelCase.

    Use this for Dict[str, Any] fields that will be consumed by the frontend.
    Pydantic's CamelCaseModel only converts field names, not dict contents.

    Following the Consumer-First Principle (see coding standards):
    - Frontend-consumed dicts → camelCase keys
    - Backend-consumed dicts → snake_case keys

    Examples:
        {"engine_type": "tts"} → {"engineType": "tts"}
        {"supported_languages": ["en"]} → {"supportedLanguages": ["en"]}
    """
    if isinstance(data, dict):
        return {to_camel(k): convert_dict_keys_to_camel(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [convert_dict_keys_to_camel(item) for item in data]
    return data


class CamelCaseModel(BaseModel):
    """
    Base model with automatic snake_case to camelCase conversion.

    All response models should inherit from this class to ensure
    consistent API response formatting.

    Configuration:
        - alias_generator: Converts field names to camelCase in JSON
        - populate_by_name: Allows both snake_case and camelCase in input
        - from_attributes: Allows creating from ORM/SQLAlchemy objects
    """
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,       # Accept both snake_case and camelCase input
        from_attributes=True          # Support ORM objects (if we ever migrate from dicts)
    )


# ============================================================================
# Segment Response Models
# ============================================================================

class SegmentResponse(CamelCaseModel):
    """
    Response model for a single segment.

    Segments are the atomic units of an audiobook chapter, each representing
    a piece of text that will be converted to speech.
    """
    id: str = Field(description="Unique segment identifier")
    chapter_id: str = Field(description="Parent chapter ID")
    text: str = Field(description="Text content to be converted to speech")
    tts_engine: str = Field(description="TTS engine used")
    tts_model_name: str = Field(description="TTS model version")
    tts_speaker_name: Optional[str] = Field(None, description="Speaker/voice name")
    language: str = Field(description="Language code)")
    segment_type: str = Field(default="standard", description="Segment type: 'standard' or 'divider'")
    pause_duration: int = Field(default=0, description="Pause duration in milliseconds (for divider segments)")
    audio_path: Optional[str] = Field(None, description="URL/path to generated audio file")
    order_index: int = Field(description="Position within chapter (0-indexed)")
    start_time: float = Field(default=0.0, description="Audio start time in seconds")
    end_time: float = Field(default=0.0, description="Audio end time in seconds")
    status: str = Field(default="pending", description="Generation status: pending, processing, completed, failed")
    is_frozen: bool = Field(default=False, description="Whether segment is frozen (protected from regeneration)")
    created_at: str = Field(description="ISO timestamp of creation")
    updated_at: str = Field(description="ISO timestamp of last update")

    # Quality analysis fields (generic format from Quality Worker)
    quality_analyzed: Optional[bool] = Field(None, description="Whether segment has been analyzed by Quality system")
    quality_score: Optional[int] = Field(None, description="Aggregated quality score (0-100)")
    quality_status: Optional[str] = Field(None, description="Quality status: 'perfect', 'warning', or 'defect'")
    engine_results: Optional[List[Dict[str, Any]]] = Field(None, description="Results from each quality engine in generic format")


# ============================================================================
# Chapter Response Models
# ============================================================================

class ChapterResponse(CamelCaseModel):
    """
    Response model for a single chapter.

    Chapters organize segments and belong to a project.
    """
    id: str = Field(description="Unique chapter identifier")
    project_id: str = Field(description="Parent project ID")
    title: str = Field(description="Chapter title")
    order_index: int = Field(description="Position within project (0-indexed)")
    created_at: str = Field(description="ISO timestamp of creation")
    updated_at: str = Field(description="ISO timestamp of last update")


class ChapterWithSegmentsResponse(ChapterResponse):
    """
    Chapter response with nested segments.

    Used when fetching a chapter with all its segments.
    """
    segments: List[SegmentResponse] = Field(default_factory=list, description="All segments in this chapter")


# ============================================================================
# Project Response Models
# ============================================================================

class ProjectResponse(CamelCaseModel):
    """
    Response model for a single project.

    Projects are the top-level containers for audiobook organization.
    """
    id: str = Field(description="Unique project identifier")
    title: str = Field(description="Project title")
    description: Optional[str] = Field(None, description="Optional project description")
    order_index: int = Field(default=0, description="Display order (0-indexed)")
    created_at: str = Field(description="ISO timestamp of creation")
    updated_at: str = Field(description="ISO timestamp of last update")


class ProjectWithChaptersResponse(ProjectResponse):
    """
    Project response with nested chapters (and optionally segments).

    Used when fetching a project with all its hierarchical content.
    """
    chapters: List[ChapterWithSegmentsResponse] = Field(
        default_factory=list,
        description="All chapters in this project with their segments"
    )


# ============================================================================
# Speaker Response Models
# ============================================================================

class SpeakerSampleResponse(CamelCaseModel):
    """
    Response model for a speaker voice sample.

    Samples are audio files used for voice cloning.
    """
    id: str = Field(description="Unique sample identifier")
    speaker_id: Optional[str] = Field(None, description="Parent speaker ID (optional when nested)")
    file_path: str = Field(description="URL/path to audio sample file")
    file_name: str = Field(description="Original filename")
    file_size: int = Field(description="File size in bytes")
    duration: Optional[float] = Field(None, description="Audio duration in seconds")
    sample_rate: Optional[int] = Field(None, description="Audio sample rate in Hz")
    transcript: Optional[str] = Field(None, description="Optional transcript")
    created_at: str = Field(description="ISO timestamp of upload")


class SpeakerResponse(CamelCaseModel):
    """
    Response model for a speaker.

    Speakers represent different voices available for TTS generation.
    """
    id: str = Field(description="Unique speaker identifier")
    name: str = Field(description="Speaker name")
    description: Optional[str] = Field(None, description="Optional speaker description")
    gender: Optional[str] = Field(None, description="Speaker gender: male, female, neutral")
    languages: List[str] = Field(default_factory=list, description="Supported languages")
    tags: List[str] = Field(default_factory=list, description="Organizational tags")
    is_default: bool = Field(default=False, description="Whether this is the default speaker")
    is_active: bool = Field(description="Whether speaker has samples (auto-computed)")
    sample_count: int = Field(default=0, description="Number of voice samples")
    created_at: str = Field(description="ISO timestamp of creation")
    updated_at: str = Field(description="ISO timestamp of last update")
    samples: List[SpeakerSampleResponse] = Field(
        default_factory=list,
        description="Voice samples for this speaker"
    )


# ============================================================================
# TTS Generation Response Models
# ============================================================================

class SegmentQueueResponse(CamelCaseModel):
    """Response for segment queued for TTS generation."""
    success: bool = Field(description="Whether segment was queued successfully")
    job_id: str = Field(description="ID of the created job")
    segment_id: str = Field(description="ID of the segment queued")
    message: str = Field(description="Human-readable status message")


class ChapterGenerationStartResponse(CamelCaseModel):
    """Response when starting chapter-wide audio generation."""
    status: str = Field(description="Start status: started, already_running")
    chapter_id: str = Field(description="Chapter identifier")
    engine: Optional[str] = Field(None, description="Engine being used")
    message: str = Field(description="Human-readable message")
    progress: Optional[float] = Field(None, description="Current progress if already running")


# ============================================================================
# Audio Export Response Models
# ============================================================================

class ExportResponse(CamelCaseModel):
    """Response when starting an audio export job."""
    job_id: str = Field(description="Unique export job identifier")
    status: str = Field(description="Initial job status")
    message: str = Field(description="Human-readable message")


class ExportProgressResponse(CamelCaseModel):
    """Progress tracking for audio export jobs."""
    job_id: str = Field(description="Export job identifier")
    status: str = Field(description="Job status: pending, running, completed, failed, cancelled")
    progress: float = Field(description="Progress percentage (0.0-1.0)")
    current_segment: int = Field(description="Current segment being processed")
    total_segments: int = Field(description="Total segments to export")
    message: str = Field(description="Current status message")
    output_path: Optional[str] = Field(None, description="URL/path to exported file (when completed)")
    file_size: Optional[int] = Field(None, description="File size in bytes (when completed)")
    duration: Optional[float] = Field(None, description="Total audio duration in seconds (when completed)")
    error: Optional[str] = Field(None, description="Error message (when failed)")


# ============================================================================
# TTS Job Management Models (Database-backed)
# ============================================================================

class TTSJobResponse(CamelCaseModel):
    """
    Response model for a single TTS job (database-backed).

    TTS jobs represent generation tasks that are persisted in the database
    and processed by the background worker. They can be chapter-wide or
    segment-specific.
    """
    id: str = Field(description="Unique job identifier (UUID)")
    chapter_id: Optional[str] = Field(None, description="Chapter being processed (context for UI navigation)")
    segment_ids: Optional[List[dict]] = Field(None, description="Parsed segment objects with job_status: [{'id': 'seg-1', 'job_status': 'pending'}, ...]")

    # Display Info (from JOINs)
    chapter_title: Optional[str] = Field(None, description="Chapter title (for UI display)")
    project_title: Optional[str] = Field(None, description="Project title (for UI display)")

    # Engine Configuration
    tts_engine: str = Field(description="TTS engine identifier")
    tts_model_name: str = Field(description="TTS model name")
    tts_speaker_name: str = Field(description="Speaker/voice name")
    language: str = Field(description="Language code")
    force_regenerate: bool = Field(description="Whether to regenerate already completed segments")

    # Progress Tracking
    status: str = Field(description="Job status: 'pending', 'running', 'cancelling', 'cancelled', 'completed', 'failed'")
    total_segments: int = Field(description="Total number of segments to process")
    processed_segments: int = Field(default=0, description="Number of segments successfully processed")
    failed_segments: int = Field(default=0, description="Number of segments that failed")
    current_segment_id: Optional[str] = Field(None, description="ID of segment currently being processed")

    # Error Handling
    error_message: Optional[str] = Field(None, description="Error details if job failed")
    retry_count: int = Field(default=0, description="Number of retry attempts")

    # Timestamps
    created_at: str = Field(description="Job creation timestamp (ISO 8601)")
    started_at: Optional[str] = Field(None, description="Job start timestamp (ISO 8601)")
    completed_at: Optional[str] = Field(None, description="Job completion timestamp (ISO 8601)")
    updated_at: str = Field(description="Last update timestamp (ISO 8601)")


class TTSJobsListResponse(CamelCaseModel):
    """
    Response model for list of TTS jobs.

    Used by endpoints that return multiple jobs with optional filtering.
    """
    success: bool = Field(default=True, description="Whether the request was successful")
    jobs: List[TTSJobResponse] = Field(
        default_factory=list,
        description="List of TTS jobs matching the query filters"
    )
    count: int = Field(description="Number of jobs returned (may be less than limit if filtered)")


# ============================================================================
# Generation Progress Models (Lightweight for fast polling)
# ============================================================================

# ============================================================================
# Health & System Response Models
# ============================================================================

class HealthResponse(CamelCaseModel):
    """Health check response."""
    status: str = Field(default="ok", description="Health status: ok, degraded, down")
    version: str = Field(description="Backend version")
    timestamp: str = Field(description="Current server timestamp")
    database: bool = Field(default=True, description="Database connectivity")
    tts_engines: List[str] = Field(default_factory=list, description="Available TTS engines")
    busy: bool = Field(default=False, description="Backend currently processing long-running operation")
    active_jobs: int = Field(default=0, description="Number of active generation/export jobs")

    # Engine availability (for feature-gating)
    # NOTE: These are Optional because they're now sent via engine.status SSE events
    # Health broadcast no longer includes these values (set to None)
    has_tts_engine: Optional[bool] = Field(default=None, description="At least one enabled TTS engine exists (via engine.status)")
    has_text_engine: Optional[bool] = Field(default=None, description="At least one enabled text engine exists (via engine.status)")
    has_stt_engine: Optional[bool] = Field(default=None, description="At least one enabled STT engine exists (via engine.status)")


class RootResponse(CamelCaseModel):
    """Root endpoint response."""
    name: str = Field(description="API name")
    version: str = Field(description="API version")
    status: str = Field(description="API status")


# ============================================================================
# Text Processing Response Models
# ============================================================================

class TextSegmentationResponse(CamelCaseModel):
    """Response for text segmentation operations."""
    success: bool = Field(description="Whether operation succeeded")
    message: str = Field(description="Status message")
    segments: List[SegmentResponse] = Field(
        default_factory=list,
        description="Created segments"
    )
    segment_count: int = Field(description="Number of segments")
    engine: str = Field(description="Engine used for constraints")
    constraints: Dict[str, int] = Field(description="Min/max length constraints applied")


# ============================================================================
# Generic Response Models
# ============================================================================

class MessageResponse(CamelCaseModel):
    """Generic success/error message response."""
    success: bool = Field(description="Whether operation succeeded")
    message: str = Field(description="Human-readable message")


class DeleteResponse(CamelCaseModel):
    """Response for delete operations."""
    success: bool = Field(default=True, description="Whether deletion succeeded")
    message: str = Field(description="Confirmation message")


class ReorderResponse(CamelCaseModel):
    """Response for reorder operations."""
    success: bool = Field(default=True, description="Whether reordering succeeded")
    message: str = Field(description="Confirmation message")
    count: Optional[int] = Field(None, description="Number of items reordered")


# ============================================================================
# Settings Response Models (Extended)
# ============================================================================

class SettingValueResponse(CamelCaseModel):
    """Response for single setting value."""
    key: str = Field(description="Setting key (supports dot notation)")
    value: Any = Field(description="Setting value (can be any JSON type)")


class AllSettingsResponse(CamelCaseModel):
    """Response for all global settings organized by category."""
    engines: Dict[str, Any] = Field(description="Global engine lifecycle settings")
    tts: Dict[str, Any] = Field(default_factory=dict, description="TTS-related settings (legacy, now in engines table)")
    audio: Dict[str, Any] = Field(description="Audio processing settings")
    text: Dict[str, Any] = Field(description="Text processing settings")
    stt: Dict[str, Any] = Field(default_factory=dict, description="STT settings (legacy, now in engines table)")
    quality: Dict[str, Any] = Field(description="Quality analysis settings")
    languages: Dict[str, Any] = Field(description="Language-related settings")


class SegmentLimitsResponse(CamelCaseModel):
    """Response for effective segment length limits."""
    user_preference: int = Field(description="User's preferred max segment length from settings")
    engine_maximum: int = Field(description="Engine's maximum allowed text length")
    effective_limit: int = Field(description="Effective limit to use (minimum of both)")


class EngineSchemaResponse(CamelCaseModel):
    """Response for engine parameter schema."""
    parameters: Dict[str, Any] = Field(description="Parameter schema dictionary for UI generation")


# ============================================================================
# Audio Utility Response Models
# ============================================================================

class MergeResponse(CamelCaseModel):
    """Response for audio merge preview operation."""
    success: bool = Field(description="Whether merge succeeded")
    audio_path: str = Field(description="URL/path to merged audio file")
    duration: float = Field(description="Total duration in seconds")


class AudioDurationResponse(CamelCaseModel):
    """Response for audio duration query."""
    file_path: str = Field(description="Audio file path queried")
    duration: float = Field(description="Audio duration in seconds")


# ============================================================================
# TTS Job Control Response Models
# ============================================================================

class CancelJobResponse(CamelCaseModel):
    """Response for job cancellation operations."""
    status: str = Field(description="Cancellation status: cancelled, cancelling, cannot_cancel, not_found")
    job_id: str = Field(description="Job identifier")
    message: str = Field(description="Human-readable status message")


class CleanupJobsResponse(CamelCaseModel):
    """Response for bulk job cleanup operations."""
    success: bool = Field(description="Whether cleanup succeeded")
    deleted: int = Field(description="Number of jobs deleted")


class DeleteJobResponse(CamelCaseModel):
    """Response for single job deletion operations."""
    success: bool = Field(description="Whether deletion succeeded")
    deleted: bool = Field(description="Deletion confirmation flag")
    job_id: str = Field(description="Deleted job identifier")


# ============================================================================
# Pronunciation Rules Response Models
# ============================================================================

class PronunciationRuleResponse(CamelCaseModel):
    """Response model for pronunciation rules."""
    id: str = Field(description="Unique rule identifier")
    pattern: str = Field(description="Text pattern to match")
    replacement: str = Field(description="Replacement text")
    is_regex: bool = Field(description="Whether pattern is regex")
    scope: str = Field(description="Rule scope: project_engine, engine, or global")
    project_id: Optional[str] = Field(None, description="Project ID (for project_engine scope)")
    engine_name: str = Field(description="TTS engine name")
    language: str = Field(description="Language code")
    is_active: bool = Field(description="Whether rule is active")
    created_at: str = Field(description="ISO timestamp of creation")
    updated_at: str = Field(description="ISO timestamp of last update")


class PronunciationRulesListResponse(CamelCaseModel):
    """Response for listing pronunciation rules."""
    rules: List[PronunciationRuleResponse] = Field(description="List of pronunciation rules")
    total: int = Field(description="Total number of rules")


class PronunciationTestResponse(CamelCaseModel):
    """Response for pronunciation rule testing."""
    original_text: str = Field(description="Original input text")
    transformed_text: str = Field(description="Text after applying rules")
    rules_applied: List[str] = Field(description="List of rules that matched")
    would_exceed_limit: bool = Field(description="Whether transformed text exceeds engine limit")
    chunks_required: int = Field(description="Number of chunks needed if split")


class PronunciationConflict(CamelCaseModel):
    """Details of a conflicting pronunciation rule."""
    rule1: Dict[str, str] = Field(description="First conflicting rule (id, pattern, scope)")
    rule2: Dict[str, str] = Field(description="Second conflicting rule (id, pattern, scope)")
    reason: str = Field(description="Conflict reason description")


class PronunciationConflictsResponse(CamelCaseModel):
    """Response for pronunciation rule conflict detection."""
    conflicts: List[PronunciationConflict] = Field(description="List of detected conflicts")
    total: int = Field(description="Total number of conflicts")


class PronunciationBulkResponse(CamelCaseModel):
    """Response for bulk pronunciation rule operations."""
    message: str = Field(description="Operation status message")
    modified: int = Field(description="Number of rules modified")


class PronunciationImportResponse(CamelCaseModel):
    """Response for pronunciation rules import operation."""
    success: bool = Field(description="Whether import succeeded")
    imported: int = Field(description="Number of rules successfully imported")
    skipped: int = Field(description="Number of rules skipped due to errors")
    message: str = Field(description="Import summary message")


class PronunciationTestAudioResponse(CamelCaseModel):
    """Response for pronunciation rule audio testing."""
    original_text: str = Field(description="Original segment text")
    transformed_text: str = Field(description="Text after applying pronunciation rule")
    rules_applied: List[str] = Field(description="List of rules that were applied")
    audio_path: Optional[str] = Field(None, description="URL/path to generated test audio file")
    message: str = Field(description="Status message")


class PronunciationExportRuleResponse(CamelCaseModel):
    """Response for a single exported pronunciation rule."""
    pattern: str = Field(description="The pattern to match")
    replacement: str = Field(description="The replacement text")
    is_regex: bool = Field(description="Whether pattern is a regex")
    scope: str = Field(description="Rule scope (global, engine, project)")
    project_id: Optional[str] = Field(None, description="Project ID if scope is project")
    engine_name: Optional[str] = Field(None, description="Engine name if scope is engine")
    language: Optional[str] = Field(None, description="Language code")
    is_active: bool = Field(description="Whether rule is active")
    created_at: str = Field(description="ISO timestamp of creation")
    updated_at: str = Field(description="ISO timestamp of last update")


class STTEngineInfo(CamelCaseModel):
    """Information about an STT engine."""
    name: str = Field(description="Engine identifier")
    display_name: str = Field(description="Human-readable engine name")
    models: List[str] = Field(description="Available model names")
    default_model: str = Field(description="Default model name")


# ============================================================================
# Quality Analysis Response Models
# ============================================================================

class QualityField(CamelCaseModel):
    """Single field in quality analysis details."""
    key: str = Field(description="i18n key for field label")
    value: Any = Field(description="Field value")
    type: str = Field(description="Rendering type: percent, seconds, text, string, number")


class QualityInfoBlockItem(CamelCaseModel):
    """Single item in an info block."""
    text: str = Field(description="i18n key or display text")
    severity: str = Field(description="Severity: error, warning, info")


class QualityEngineDetails(CamelCaseModel):
    """Engine-specific details for UI rendering."""
    top_label: str = Field(description="i18n key for section header")
    fields: List[QualityField] = Field(default_factory=list, description="Key-value pairs")
    info_blocks: Dict[str, List[QualityInfoBlockItem]] = Field(
        default_factory=dict,
        description="Grouped messages/issues"
    )


class QualityEngineResult(CamelCaseModel):
    """Result from a single analysis engine."""
    engine_type: str = Field(description="Engine type: stt or audio")
    engine_name: str = Field(description="Engine identifier")
    quality_score: int = Field(description="Quality score 0-100")
    quality_status: str = Field(description="Status: perfect, warning, defect")
    details: QualityEngineDetails = Field(description="Engine-specific details")


class QualityAnalysisResult(CamelCaseModel):
    """Combined quality analysis result for a segment."""
    quality_score: int = Field(description="Aggregated score 0-100")
    quality_status: str = Field(description="Worst status: perfect, warning, defect")
    engines: List[QualityEngineResult] = Field(
        default_factory=list,
        description="Results from each engine"
    )


class QualityJobSegmentStatus(CamelCaseModel):
    """Segment status within a quality job."""
    id: str
    job_status: str  # 'pending' or 'analyzed'


class QualityJobResponse(CamelCaseModel):
    """Quality job status response."""
    id: str
    job_type: str
    status: str
    stt_engine: Optional[str] = None
    stt_model_name: Optional[str] = None
    audio_engine: Optional[str] = None
    language: str
    total_segments: int
    processed_segments: int
    failed_segments: int = 0
    current_segment_id: Optional[str] = None
    chapter_id: Optional[str] = None
    segment_id: Optional[str] = None
    segment_ids: Optional[List[QualityJobSegmentStatus]] = None  # Segment tracking
    trigger_source: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    # Display fields (from JOINs)
    chapter_title: Optional[str] = None
    project_title: Optional[str] = None


class QualityJobsListResponse(CamelCaseModel):
    """
    Response model for list of quality jobs.

    Used by endpoints that return multiple jobs with optional filtering.
    """
    success: bool = Field(default=True, description="Whether the request was successful")
    jobs: List[QualityJobResponse] = Field(
        default_factory=list,
        description="List of quality jobs matching the query filters"
    )
    count: int = Field(description="Number of jobs returned (may be less than limit if filtered)")


class QualityJobCreatedResponse(CamelCaseModel):
    """Response when quality job is created."""
    job_id: str
    message: str
    status: str


# ============================================================================
# Import System Models
# ============================================================================

class MappingRules(CamelCaseModel):
    """Configurable markdown parsing rules"""
    project_heading: str = "#"  # Default: # Heading 1
    chapter_heading: str = "###"  # Default: ### Heading 3
    divider_pattern: str = "***"  # Default: ***


class ImportWarning(CamelCaseModel):
    """Warning or error from import validation"""
    type: str  # e.g., 'too_long', 'empty', 'no_project_title'
    message: str
    severity: Literal["critical", "warning", "info"]


class ChapterStats(CamelCaseModel):
    """Chapter statistics (auto-converts snake_case → camelCase for frontend)"""
    segment_count: int = Field(description="Total number of segments in chapter")
    total_chars: int = Field(description="Total character count")
    divider_count: int = Field(description="Number of divider segments")
    failed_count: int = Field(description="Number of oversized segments (sentences > max_length)")


class ChapterPreview(CamelCaseModel):
    """Preview of a chapter with statistics (segments not included for performance)"""
    id: str  # Temporary ID for frontend
    title: str  # Cleaned title
    original_title: str  # Raw title from markdown
    order_index: int
    # segments: List[SegmentPreview]  # Commented out - only stats shown in preview
    stats: ChapterStats  # Automatic camelCase conversion (segmentCount, totalChars, etc.)
    warnings: List[ImportWarning]


class ImportStats(CamelCaseModel):
    """Overall import statistics"""
    total_chapters: int
    total_segments: int
    total_chars: int
    estimated_duration: Optional[str] = None  # e.g., "~15min"


class ImportPreviewResponse(CamelCaseModel):
    """Complete preview response for import"""
    is_valid: bool  # False if critical warnings exist
    project: Dict[str, Any]  # title, description
    chapters: List[ChapterPreview]
    global_warnings: List[ImportWarning]
    stats: ImportStats


class ImportConfig(CamelCaseModel):
    """Configuration for final import"""
    mode: Literal["new", "merge"]
    merge_target_id: Optional[str] = None
    selected_chapters: List[Dict[str, Any]]  # [{original_title, new_title?, include}]
    tts_settings: Dict[str, Any]  # tts_engine, tts_model_name, language, tts_speaker_name


class ImportExecuteResponse(CamelCaseModel):
    """Response for import execution (POST /api/projects/import)"""
    project: ProjectWithChaptersResponse = Field(description="Created or updated project with chapters and segments")
    chapters_created: int = Field(description="Number of chapters created/added")
    segments_created: int = Field(description="Total number of segments created")


# ============================================================================
# Engine Management Response Models
# ============================================================================

class EngineStatusInfo(CamelCaseModel):
    """
    Detailed engine status for management UI.

    Used by /api/engines/status endpoint to display engine status across all types.

    Status Values (complete lifecycle):
        - 'disabled': Engine is disabled in settings (not available for use)
        - 'stopped': Engine is enabled but not running
        - 'starting': Engine server is being started (process launching, waiting for health check)
        - 'running': Engine server is running and healthy
        - 'stopping': Engine server is being stopped (shutdown in progress)
        - 'error': Engine encountered an error
    """
    variant_id: str = Field(description="Unique engine variant identifier (e.g., 'xtts:local', 'xtts:docker:local')")
    display_name: str = Field(description="Human-readable display name")
    version: str = Field(description="Engine version")
    engine_type: str = Field(description="Engine type: 'tts', 'text', 'stt', or 'audio'")

    # Status
    is_enabled: bool = Field(description="Whether engine is enabled in settings")
    is_running: bool = Field(description="Whether engine server is currently running")
    is_default: bool = Field(default=False, description="True for default engine of its type")
    is_pulling: bool = Field(default=False, description="True when Docker image pull is in progress")
    status: str = Field(description="Status: 'disabled', 'stopped', 'starting', 'running', 'stopping', 'error'")
    port: Optional[int] = Field(None, description="HTTP port if engine is running")
    error_message: Optional[str] = Field(None, description="Error message if status='error'")

    # Auto-stop info
    idle_timeout_seconds: Optional[int] = Field(None, description="Inactivity timeout in seconds (None = exempt from auto-stop)")
    seconds_until_auto_stop: Optional[int] = Field(None, description="Seconds remaining until auto-stop (None = not applicable)")
    keep_running: bool = Field(default=False, description="Whether engine is kept running (prevents auto-stop)")

    # Capabilities
    supported_languages: List[str] = Field(default_factory=list, description="Supported ISO language codes (filtered by allowedLanguages for TTS)")
    all_supported_languages: List[str] = Field(default_factory=list, description="All supported ISO language codes (unfiltered, for Settings UI)")
    device: str = Field(default="cpu", description="Device: 'cpu' or 'cuda'")

    # GPU memory info (only populated when device='cuda' and engine is running)
    gpu_memory_used_mb: Optional[int] = Field(None, description="GPU VRAM used by this engine (MB)")
    gpu_memory_total_mb: Optional[int] = Field(None, description="GPU VRAM total (MB)")

    # Models (for engines that support multiple models)
    available_models: List[str] = Field(default_factory=list, description="List of available model names")
    loaded_model: Optional[str] = Field(None, description="Currently loaded model name")
    default_model_name: Optional[str] = Field(None, description="Default model name (from engine_models.is_default)")
    default_language: Optional[str] = Field(None, description="Default language from settings (per-engine, for TTS)")

    # Variant fields (for engine variants architecture)
    base_engine_name: Optional[str] = Field(None, description="Base engine name without runner (e.g., 'xtts')")
    runner_id: Optional[str] = Field(None, description="Runner identifier (e.g., 'local', 'docker:local')")
    runner_type: Optional[str] = Field(None, description="'subprocess' | 'docker:local' | 'docker:remote'")
    runner_host: Optional[str] = Field(None, description="Host name for Docker runners")
    source: Optional[str] = Field(None, description="'local' | 'docker'")

    # Docker-specific fields
    docker_image: Optional[str] = Field(None, description="Docker image name (for docker variants)")
    docker_tag: Optional[str] = Field(None, description="Installed Docker image tag (e.g., 'latest', 'cpu')")
    is_installed: Optional[bool] = Field(None, description="Whether Docker image is installed")

    # Engine parameters (user-configured values from engines table)
    parameters: Optional[Dict[str, Any]] = Field(None, description="Engine-specific parameters")


class AllEnginesStatusResponse(CamelCaseModel):
    """
    All engines grouped by type.

    Used by /api/engines/status endpoint for Engine Management UI.
    """
    success: bool = Field(description="Whether operation succeeded")
    tts: List[EngineStatusInfo] = Field(default_factory=list, description="TTS engines")
    text: List[EngineStatusInfo] = Field(default_factory=list, description="Text processing engines")
    stt: List[EngineStatusInfo] = Field(default_factory=list, description="Speech-to-text engines")
    audio: List[EngineStatusInfo] = Field(default_factory=list, description="Audio analysis engines")

    # Summary for feature-gating
    has_tts_engine: bool = Field(description="At least one enabled TTS engine exists")
    has_text_engine: bool = Field(description="At least one enabled text engine exists")
    has_stt_engine: bool = Field(description="At least one enabled STT engine exists")

    # Variant grouping for UI
    variant_groups: Optional[Dict[str, List[EngineStatusInfo]]] = Field(
        None,
        description="Engines grouped by runner type: {'subprocess': [...], 'docker:local': [...]}"
    )


# ============================================================================
# Docker Catalog Response Models
# ============================================================================

class DockerImageVariant(CamelCaseModel):
    """Information about a specific Docker image variant (tag)."""
    tag: str = Field(description="Docker image tag (e.g., 'latest', 'cpu')")
    requires_gpu: bool = Field(default=False, description="Whether this variant requires GPU")


class DockerImageInfo(CamelCaseModel):
    """Docker image information from catalog."""
    engine_name: str = Field(description="Base engine name (e.g., 'xtts')")
    image: str = Field(description="Docker image name")
    engine_type: str = Field(description="Engine type: 'tts', 'stt', 'text', 'audio'")
    display_name: str = Field(description="Human-readable name")
    description: str = Field(default="", description="Engine description")
    requires_gpu: bool = Field(default=False, description="Whether GPU is required (any variant)")
    tags: List[str] = Field(default_factory=list, description="Available image tags")
    default_tag: str = Field(default="latest", description="Default tag to use")
    supported_languages: List[str] = Field(default_factory=list, description="Supported ISO language codes")
    models: List[str] = Field(default_factory=list, description="Available models")
    variants: List[DockerImageVariant] = Field(default_factory=list, description="Variant-specific metadata (tag + GPU requirement)")


class DockerCatalogResponse(CamelCaseModel):
    """Response for GET /api/engines/catalog."""
    success: bool = Field(description="Whether operation succeeded")
    images: List[DockerImageInfo] = Field(default_factory=list, description="Available Docker images")


class DockerInstallResponse(CamelCaseModel):
    """Response for Docker image install/uninstall."""
    success: bool = Field(description="Whether operation succeeded")
    variant_id: str = Field(description="Variant ID that was modified")
    message: str = Field(description="Status message")
    is_installed: bool = Field(description="Current installation status")


class ImageUpdateCheckResponse(CamelCaseModel):
    """
    Response for Docker image update check.

    Compares local image digest with registry to detect available updates
    without downloading the full image.
    """
    success: bool = Field(description="Whether the check completed successfully")
    variant_id: str = Field(description="Engine variant ID that was checked")
    is_installed: bool = Field(description="Whether image exists locally")
    update_available: Optional[bool] = Field(None, description="True if update available, None if unknown/not installed")
    local_digest: Optional[str] = Field(None, description="Local image digest (truncated)")
    remote_digest: Optional[str] = Field(None, description="Remote registry digest (truncated)")
    error: Optional[str] = Field(None, description="Error message if check failed")


# ============================================================================
# Engine Host Response Models
# ============================================================================

class EngineHostResponse(CamelCaseModel):
    """Response model for an engine host."""
    host_id: str = Field(description="Unique host identifier")
    host_type: str = Field(description="Host type: 'subprocess', 'docker:local', 'docker:remote'")
    display_name: str = Field(description="Human-readable name")
    ssh_url: Optional[str] = Field(None, description="SSH URL for remote Docker hosts")
    is_available: bool = Field(default=True, description="Whether host is available")
    has_gpu: Optional[bool] = Field(None, description="Whether host has NVIDIA GPU runtime (null if not tested)")
    last_checked_at: Optional[str] = Field(None, description="Last availability check timestamp")
    created_at: str = Field(description="Creation timestamp")
    engine_count: int = Field(default=0, description="Number of engines on this host")


class EngineHostsListResponse(CamelCaseModel):
    """Response for listing engine hosts."""
    success: bool = Field(default=True)
    hosts: List[EngineHostResponse] = Field(description="List of hosts")
    count: int = Field(description="Number of hosts")


class ConnectionTestResponse(CamelCaseModel):
    """Response for connection test."""
    success: bool = Field(description="Whether connection succeeded")
    docker_version: Optional[str] = Field(None, description="Docker version")
    os: Optional[str] = Field(None, description="Host OS")
    error: Optional[str] = Field(None, description="Error message if failed")


class DockerVolumesResponse(CamelCaseModel):
    """Response for Docker volume configuration."""
    success: bool = Field(default=True, description="Whether operation succeeded")
    host_id: str = Field(description="Host identifier")
    samples_path: Optional[str] = Field(None, description="Host path for speaker samples")
    models_path: Optional[str] = Field(None, description="Host path for external models")
    validation_error: Optional[str] = Field(None, description="Path validation error if any")


class PrepareHostResponse(CamelCaseModel):
    """Response for prepare host operation (SSH key generation)."""
    success: bool = Field(default=True, description="Whether key generation succeeded")
    host_id: str = Field(description="Generated host identifier")
    public_key: str = Field(description="Public key to add to remote authorized_keys")
    install_command: str = Field(description="Shell command to install the key on remote host")
    authorized_keys_entry: str = Field(description="The authorized_keys entry with restrictions")


class TestHostResponse(CamelCaseModel):
    """Response from testing a remote Docker host connection."""
    success: bool = Field(description="Whether connection test succeeded")
    docker_version: Optional[str] = Field(None, description="Docker version on remote host")
    has_gpu: bool = Field(default=False, description="Whether host has NVIDIA GPU runtime")
    has_docker_permission: bool = Field(default=False, description="Whether user can access Docker")
    error: Optional[str] = Field(None, description="Error message if test failed")
    error_category: Optional[str] = Field(None, description="Error category for i18n")


class HostPublicKeyResponse(CamelCaseModel):
    """Response for host public key retrieval."""
    success: bool = Field(default=True, description="Whether key was found")
    host_id: str = Field(description="Host identifier")
    public_key: Optional[str] = Field(None, description="Public key for the host")
    install_command: Optional[str] = Field(None, description="Shell command to install the key")


# ============================================================================
# Docker/Catalog Response Models
# ============================================================================

class CatalogSyncResponse(CamelCaseModel):
    """Response from catalog sync operation"""

    success: bool
    added: int = 0
    updated: int = 0
    skipped: int = 0
    message: str = ""


class DiscoverModelsResponse(CamelCaseModel):
    """Response for model discovery."""

    success: bool
    variant_id: str
    models: List[str]
    message: str


class DockerDiscoverResponse(CamelCaseModel):
    """Response from Docker engine discovery"""
    success: bool
    engine_info: Optional[Dict[str, Any]] = None  # The /info Response
    error: Optional[str] = None


class DockerRegisterResponse(CamelCaseModel):
    """Response from Docker engine registration"""
    success: bool
    variant_id: Optional[str] = None  # e.g. "my-tts:docker:local"
    error: Optional[str] = None
