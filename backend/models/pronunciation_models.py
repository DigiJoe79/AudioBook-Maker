"""Pydantic models for pronunciation rules."""
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from models.response_models import to_camel

class PronunciationRuleBase(BaseModel):
    """Base model for pronunciation rules."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    pattern: str = Field(..., min_length=1, max_length=500)
    replacement: str = Field(..., min_length=1, max_length=500)
    is_regex: bool = False
    scope: Literal["project_engine", "engine"]
    project_id: Optional[str] = None
    engine_name: str
    language: str = Field(..., min_length=2, max_length=10)
    is_active: bool = True

class PronunciationRuleCreate(PronunciationRuleBase):
    """Model for creating a pronunciation rule."""
    pass

class PronunciationRuleUpdate(BaseModel):
    """Model for updating a pronunciation rule."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    pattern: Optional[str] = Field(None, min_length=1, max_length=500)
    replacement: Optional[str] = Field(None, min_length=1, max_length=500)
    is_regex: Optional[bool] = None
    scope: Optional[Literal["project_engine", "engine"]] = None
    project_id: Optional[str] = None
    engine_name: Optional[str] = None
    language: Optional[str] = Field(None, min_length=2, max_length=10)
    is_active: Optional[bool] = None

class PronunciationRule(PronunciationRuleBase):
    """Complete pronunciation rule model."""
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class PronunciationTestRequest(BaseModel):
    """Request model for testing pronunciation rules."""
    text: str = Field(..., min_length=1, max_length=500)
    rule: PronunciationRuleBase
    segment_id: Optional[str] = None  # For context-aware testing
