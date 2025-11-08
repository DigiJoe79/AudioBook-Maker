"""
Backend Models Package

Contains Pydantic response models for FastAPI endpoints with automatic
snake_case to camelCase conversion.
"""

from .response_models import (
    # Base
    CamelCaseModel,
    to_camel,

    # Segments
    SegmentResponse,

    # Chapters
    ChapterResponse,
    ChapterWithSegmentsResponse,

    # Projects
    ProjectResponse,
    ProjectWithChaptersResponse,

    # Speakers
    SpeakerResponse,
    SpeakerSampleResponse,

    # TTS
    TTSEngineInfo,
    TTSGenerationResponse,
    TTSProgressResponse,
    TTSOptionsResponse,

    # Audio Export
    ExportResponse,
    ExportProgressResponse,
    ExportJobResponse,

    # Settings
    SettingsResponse,

    # Health
    HealthResponse,

    # Text Processing
    TextSegmentPreview,
    TextSegmentationResponse,

    # Generic
    MessageResponse,
    DeleteResponse,
    ReorderResponse,
)

__all__ = [
    # Base
    "CamelCaseModel",
    "to_camel",

    # Segments
    "SegmentResponse",

    # Chapters
    "ChapterResponse",
    "ChapterWithSegmentsResponse",

    # Projects
    "ProjectResponse",
    "ProjectWithChaptersResponse",

    # Speakers
    "SpeakerResponse",
    "SpeakerSampleResponse",

    # TTS
    "TTSEngineInfo",
    "TTSGenerationResponse",
    "TTSProgressResponse",
    "TTSOptionsResponse",

    # Audio Export
    "ExportResponse",
    "ExportProgressResponse",
    "ExportJobResponse",

    # Settings
    "SettingsResponse",

    # Health
    "HealthResponse",

    # Text Processing
    "TextSegmentPreview",
    "TextSegmentationResponse",

    # Generic
    "MessageResponse",
    "DeleteResponse",
    "ReorderResponse",
]
