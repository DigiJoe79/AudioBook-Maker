"""
Backend Models Package

Contains Pydantic response models for FastAPI endpoints with automatic
snake_case to camelCase conversion.
"""

from .response_models import (
    CamelCaseModel,
    to_camel,

    SegmentResponse,

    ChapterResponse,
    ChapterWithSegmentsResponse,

    ProjectResponse,
    ProjectWithChaptersResponse,

    SpeakerResponse,
    SpeakerSampleResponse,

    TTSEngineInfo,
    TTSGenerationResponse,
    TTSProgressResponse,
    TTSOptionsResponse,

    ExportResponse,
    ExportProgressResponse,
    ExportJobResponse,

    SettingsResponse,

    HealthResponse,

    TextSegmentPreview,
    TextSegmentationResponse,

    MessageResponse,
    DeleteResponse,
    ReorderResponse,
)

__all__ = [
    "CamelCaseModel",
    "to_camel",

    "SegmentResponse",

    "ChapterResponse",
    "ChapterWithSegmentsResponse",

    "ProjectResponse",
    "ProjectWithChaptersResponse",

    "SpeakerResponse",
    "SpeakerSampleResponse",

    "TTSEngineInfo",
    "TTSGenerationResponse",
    "TTSProgressResponse",
    "TTSOptionsResponse",

    "ExportResponse",
    "ExportProgressResponse",
    "ExportJobResponse",

    "SettingsResponse",

    "HealthResponse",

    "TextSegmentPreview",
    "TextSegmentationResponse",

    "MessageResponse",
    "DeleteResponse",
    "ReorderResponse",
]
