"""Pydantic models for Whisper STT Engine."""
from typing import List
from pydantic import BaseModel, Field


class WordAnalysis(BaseModel):
    """Word-level analysis result."""
    word: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    start: float = Field(..., description="Start time in seconds")
    end: float = Field(..., description="End time in seconds")


class AnalyzeResponse(BaseModel):
    """Internal response model for Whisper transcription."""
    transcription: str
    confidence: int = Field(..., ge=0, le=100, description="Confidence score (0-100)")
    words: List[WordAnalysis] = Field(default_factory=list)
    language: str
    duration: float = Field(..., description="Audio duration in seconds")
