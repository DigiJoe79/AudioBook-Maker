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
        segment = segment_repo.get_by_id(id)
        return segment

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
from typing import Optional, List, Dict, Any


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


class CamelCaseModel(BaseModel):
    """
    Base model with automatic snake_case to camelCase conversion.

    All response models should inherit from this class to ensure
    consistent API response formatting.

    Configuration:
        - alias_generator: Converts field names to camelCase in JSON
        - populate_by_name: Allows both snake_case and camelCase in input
        - from_attributes: Allows creating from ORM/SQLAlchemy objects
        - protected_namespaces: Empty to allow 'model_' prefix fields
    """
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        protected_namespaces=()
    )



class SegmentResponse(CamelCaseModel):
    """
    Response model for a single segment.

    Segments are the atomic units of an audiobook chapter, each representing
    a piece of text that will be converted to speech.
    """
    id: str = Field(description="Unique segment identifier")
    chapter_id: str = Field(description="Parent chapter ID")
    text: str = Field(description="Text content to be converted to speech")
    engine: str = Field(description="TTS engine used (e.g., 'xtts', 'dummy')")
    model_name: str = Field(description="TTS model version (e.g., 'v2.0.3')")
    speaker_name: Optional[str] = Field(None, description="Speaker/voice name")
    language: str = Field(description="Language code (e.g., 'de', 'en')")
    segment_type: str = Field(default="standard", description="Segment type: 'standard' or 'divider'")
    pause_duration: int = Field(default=0, description="Pause duration in milliseconds (for divider segments)")
    audio_path: Optional[str] = Field(None, description="URL/path to generated audio file")
    order_index: int = Field(description="Position within chapter (0-indexed)")
    start_time: float = Field(default=0.0, description="Audio start time in seconds")
    end_time: float = Field(default=0.0, description="Audio end time in seconds")
    status: str = Field(default="pending", description="Generation status: pending, processing, completed, failed")
    created_at: str = Field(description="ISO timestamp of creation")
    updated_at: str = Field(description="ISO timestamp of last update")



class ChapterResponse(CamelCaseModel):
    """
    Response model for a single chapter.

    Chapters organize segments and belong to a project.
    """
    id: str = Field(description="Unique chapter identifier")
    project_id: str = Field(description="Parent project ID")
    title: str = Field(description="Chapter title")
    order_index: int = Field(description="Position within project (0-indexed)")
    default_engine: str = Field(description="Default TTS engine for new segments")
    default_model_name: str = Field(description="Default TTS model for new segments")
    created_at: str = Field(description="ISO timestamp of creation")
    updated_at: str = Field(description="ISO timestamp of last update")


class ChapterWithSegmentsResponse(ChapterResponse):
    """
    Chapter response with nested segments.

    Used when fetching a chapter with all its segments.
    """
    segments: List[SegmentResponse] = Field(default_factory=list, description="All segments in this chapter")



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



class TTSOptionsResponse(CamelCaseModel):
    """TTS generation options."""
    temperature: float = Field(default=0.75, description="Generation creativity (0.0-1.0)")
    length_penalty: float = Field(default=1.0, description="Audio length control")
    repetition_penalty: float = Field(default=2.0, description="Repetition prevention")
    top_k: int = Field(default=50, description="Top-K sampling parameter")
    top_p: float = Field(default=0.85, description="Nucleus sampling parameter")
    speed: float = Field(default=1.0, description="Playback speed multiplier")


class GenerationConstraints(CamelCaseModel):
    """TTS engine generation constraints."""
    min_text_length: int = Field(description="Minimum text length for generation")
    max_text_length: int = Field(description="Default maximum text length")
    max_text_length_by_lang: Optional[Dict[str, int]] = Field(None, description="Language-specific max lengths")
    sample_rate: int = Field(description="Audio sample rate in Hz")
    audio_format: str = Field(description="Output audio format")
    supports_streaming: bool = Field(description="Whether engine supports streaming")
    requires_punctuation: bool = Field(description="Whether proper punctuation is required")


class TTSEngineInfo(CamelCaseModel):
    """Full TTS engine information with capabilities."""
    name: str = Field(description="Unique engine identifier (e.g., 'xtts', 'dummy')")
    display_name: str = Field(description="Human-readable display name")
    supported_languages: List[str] = Field(description="List of supported ISO language codes")
    constraints: GenerationConstraints = Field(description="Engine-specific generation constraints")
    default_parameters: Dict[str, Any] = Field(description="Engine-specific default parameters")
    model_loaded: bool = Field(description="Whether the model is currently loaded in memory")
    device: str = Field(default="cpu", description="Device being used (cpu/cuda)")


class EnginesListResponse(CamelCaseModel):
    """Response for listing available TTS engines."""
    success: bool = Field(description="Whether operation succeeded")
    engines: List[TTSEngineInfo] = Field(description="List of available TTS engines")
    count: int = Field(description="Number of engines returned")


class EngineInitializeResponse(CamelCaseModel):
    """Response for engine initialization."""
    success: bool = Field(description="Whether initialization succeeded")
    engine: str = Field(description="Engine identifier")
    display_name: str = Field(description="Human-readable engine name")
    model_name: str = Field(description="Model name/version loaded")
    languages: List[str] = Field(description="Supported languages")
    constraints: GenerationConstraints = Field(description="Generation constraints")
    default_parameters: Dict[str, Any] = Field(description="Default parameters")
    model_loaded: bool = Field(description="Whether model is loaded in memory")


class TTSModelInfo(CamelCaseModel):
    """Information about a specific TTS model."""
    model_name: str = Field(description="Model identifier (e.g., 'v2.0.2', 'custom')")
    display_name: str = Field(description="Human-readable display name")
    path: str = Field(description="Full path to model directory")
    version: str = Field(description="Version string")
    size_mb: Optional[float] = Field(None, description="Model size in MB")


class ModelsListResponse(CamelCaseModel):
    """Response for listing available models for an engine."""
    success: bool = Field(description="Whether operation succeeded")
    engine: str = Field(description="Engine type identifier")
    models: List[TTSModelInfo] = Field(description="List of available models")
    count: int = Field(description="Number of models returned")


class TTSGenerationResponse(CamelCaseModel):
    """Response for TTS generation operations."""
    success: bool = Field(description="Whether operation succeeded")
    message: str = Field(description="Human-readable status message")
    segment: Optional[SegmentResponse] = Field(None, description="Updated segment (if single generation)")
    segments: Optional[List[SegmentResponse]] = Field(None, description="Updated segments (if batch generation)")


class TTSProgressResponse(CamelCaseModel):
    """Progress tracking for chapter-wide TTS generation."""
    chapter_id: str = Field(description="Chapter being generated")
    status: str = Field(description="Status: pending, running, completed, failed")
    progress: float = Field(description="Progress percentage (0.0-1.0)")
    current_segment: int = Field(description="Current segment index")
    total_segments: int = Field(description="Total segments to generate")
    message: str = Field(description="Current status message")
    error: Optional[str] = Field(None, description="Error message if failed")


class ChapterGenerationStartResponse(CamelCaseModel):
    """Response when starting chapter-wide audio generation."""
    status: str = Field(description="Start status: started, already_running")
    chapter_id: str = Field(description="Chapter identifier")
    engine: Optional[str] = Field(None, description="Engine being used")
    message: str = Field(description="Human-readable message")
    progress: Optional[float] = Field(None, description="Current progress if already running")


class ChapterGenerationCancelResponse(CamelCaseModel):
    """Response when cancelling chapter generation."""
    success: bool = Field(description="Whether cancellation succeeded")
    chapter_id: str = Field(description="Chapter identifier")
    message: str = Field(description="Human-readable message")



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


class ExportJobResponse(CamelCaseModel):
    """Full export job details."""
    id: str = Field(description="Unique job identifier")
    chapter_id: str = Field(description="Chapter being exported")
    status: str = Field(description="Job status")
    output_format: str = Field(description="Target format: mp3, wav, m4a")
    output_path: Optional[str] = Field(None, description="Final file path/URL")
    bitrate: Optional[str] = Field(None, description="Audio bitrate (e.g., '192k')")
    sample_rate: int = Field(default=24000, description="Audio sample rate in Hz")
    pause_between_segments: int = Field(default=500, description="Pause between segments in ms")
    total_segments: int = Field(description="Total segments to merge")
    merged_segments: int = Field(default=0, description="Segments processed so far")
    file_size: Optional[int] = Field(None, description="Output file size in bytes")
    duration: Optional[float] = Field(None, description="Total duration in seconds")
    error_message: Optional[str] = Field(None, description="Error details if failed")
    created_at: str = Field(description="Job creation timestamp")
    updated_at: str = Field(description="Last update timestamp")
    started_at: Optional[str] = Field(None, description="Job start timestamp")
    completed_at: Optional[str] = Field(None, description="Job completion timestamp")



class SettingsResponse(CamelCaseModel):
    """Application settings response."""
    id: str = Field(default="default", description="Settings profile ID")

    theme: str = Field(default="system", description="UI theme: light, dark, system")
    language: str = Field(default="de", description="UI language: de, en")

    default_engine: str = Field(default="dummy", description="Default TTS engine")
    default_model: str = Field(default="dummy", description="Default TTS model")
    default_language: str = Field(default="de", description="Default audio language")
    default_speaker: Optional[str] = Field(None, description="Default speaker name")

    temperature: float = Field(default=0.75, description="Default temperature")
    speed: float = Field(default=1.0, description="Default speed")
    length_penalty: float = Field(default=1.0, description="Default length penalty")
    repetition_penalty: float = Field(default=2.0, description="Default repetition penalty")
    top_k: int = Field(default=50, description="Default top-K")
    top_p: float = Field(default=0.85, description="Default top-P")

    max_segment_length: int = Field(default=500, description="Max segment length")
    enable_text_splitting: bool = Field(default=True, description="Auto-split long texts")

    export_format: str = Field(default="mp3", description="Default export format")
    export_bitrate: str = Field(default="192k", description="Default export bitrate")
    export_sample_rate: int = Field(default=24000, description="Default sample rate")

    created_at: str = Field(description="Settings creation timestamp")
    updated_at: str = Field(description="Last update timestamp")



class GenerationJobStatus(CamelCaseModel):
    """Status of a single generation job (for fast polling)"""
    status: str = Field(description="Job status: running, completed, failed, cancelled")
    progress: int = Field(default=0, description="Current segment index being processed (0-based)")
    total: int = Field(default=0, description="Total segments to process")
    current_segment: Optional[str] = Field(default=None, description="ID of current segment being processed")
    errors: int = Field(default=0, description="Number of errors encountered")
    updated_at: float = Field(description="Timestamp of last update (Unix time)")


class GenerationStatusResponse(CamelCaseModel):
    """
    Lightweight response for polling active generation jobs.

    This endpoint is designed for high-frequency polling (250-500ms) to provide
    real-time UI updates without heavy database queries. Only returns in-memory
    job status data.
    """
    active_jobs: Dict[str, GenerationJobStatus] = Field(
        default_factory=dict,
        description="Map of chapter IDs to their generation job status. Only includes running jobs."
    )



class HealthResponse(CamelCaseModel):
    """Health check response."""
    status: str = Field(default="ok", description="Health status: ok, degraded, down")
    version: str = Field(description="Backend version")
    timestamp: str = Field(description="Current server timestamp")
    database: bool = Field(default=True, description="Database connectivity")
    tts_engines: List[str] = Field(default_factory=list, description="Available TTS engines")
    busy: bool = Field(default=False, description="Backend currently processing long-running operation")
    active_jobs: int = Field(default=0, description="Number of active generation/export jobs")


class RootResponse(CamelCaseModel):
    """Root endpoint response."""
    name: str = Field(description="API name")
    version: str = Field(description="API version")
    status: str = Field(description="API status")



class TextSegmentPreview(CamelCaseModel):
    """Preview of a text segment before creation."""
    text: str = Field(description="Segment text content")
    order_index: int = Field(description="Segment position")
    length: int = Field(description="Character count")


class TextSegmentationResponse(CamelCaseModel):
    """Response for text segmentation operations."""
    success: bool = Field(description="Whether operation succeeded")
    message: str = Field(description="Status message")
    segments: List[SegmentResponse] = Field(
        default_factory=list,
        description="Created segments (if auto_create=true)"
    )
    preview: Optional[List[TextSegmentPreview]] = Field(
        None,
        description="Segment previews (if auto_create=false)"
    )
    segment_count: int = Field(description="Number of segments")
    engine: str = Field(description="Engine used for constraints")
    constraints: Dict[str, int] = Field(description="Min/max length constraints applied")



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



class SettingValueResponse(CamelCaseModel):
    """Response for single setting value."""
    key: str = Field(description="Setting key (supports dot notation)")
    value: Any = Field(description="Setting value (can be any JSON type)")


class AllSettingsResponse(CamelCaseModel):
    """Response for all global settings organized by category."""
    tts: Dict[str, Any] = Field(description="TTS-related settings")
    audio: Dict[str, Any] = Field(description="Audio processing settings")
    text: Dict[str, Any] = Field(description="Text processing settings")


class SegmentLimitsResponse(CamelCaseModel):
    """Response for effective segment length limits."""
    user_preference: int = Field(description="User's preferred max segment length from settings")
    engine_maximum: int = Field(description="Engine's maximum allowed text length")
    effective_limit: int = Field(description="Effective limit to use (minimum of both)")


class EngineSchemaResponse(CamelCaseModel):
    """Response for engine parameter schema."""
    parameters: Dict[str, Any] = Field(description="Parameter schema dictionary for UI generation")



class MergeResponse(CamelCaseModel):
    """Response for audio merge preview operation."""
    success: bool = Field(description="Whether merge succeeded")
    audio_path: str = Field(description="URL/path to merged audio file")
    duration: float = Field(description="Total duration in seconds")


class AudioDurationResponse(CamelCaseModel):
    """Response for audio duration query."""
    file_path: str = Field(description="Audio file path queried")
    duration: float = Field(description="Audio duration in seconds")



class MarkdownImportResponse(CamelCaseModel):
    """Response for markdown import operation."""
    success: bool = Field(description="Whether import succeeded")
    project: ProjectWithChaptersResponse = Field(description="Created project with chapters and segments")
    total_segments: int = Field(description="Total standard segments created")
    total_dividers: int = Field(description="Total divider segments created")
    message: str = Field(description="Success message")
