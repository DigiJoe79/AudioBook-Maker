"""
API endpoints for text processing and segmentation
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal, List

from services.text_segmenter import get_segmenter
from models.response_models import CamelCaseModel

router = APIRouter(tags=["text-processing"])


class SegmentTextResponse(CamelCaseModel):
    """Response for text segmentation test endpoint"""
    success: bool
    method: str
    language: str
    segment_count: int
    segments: List[str]


class SegmentRequest(BaseModel):
    text: str
    method: Literal["sentences", "paragraphs", "smart", "length"] = "smart"
    language: str = "de"
    min_length: int = 50
    max_length: int = 500


@router.post("/segment-text", response_model=SegmentTextResponse)
async def segment_text(request: SegmentRequest):
    """
    Test endpoint: Segment text without creating database entries

    Args:
        request: Segmentation parameters

    Returns:
        List of text segments
    """
    try:
        segmenter = get_segmenter(request.language)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load text segmenter: {str(e)}. "
                   f"Make sure to install spaCy models: python -m spacy download {get_segmenter._get_default_model(request.language) if hasattr(get_segmenter, '_get_default_model') else 'de_core_news_sm'}"
        )

    try:
        if request.method == "sentences":
            segments = segmenter.segment_by_sentences(
                request.text,
                min_length=request.min_length,
                max_length=request.max_length
            )
        elif request.method == "paragraphs":
            segments = segmenter.segment_by_paragraphs(request.text)
        elif request.method == "smart":
            segments = segmenter.segment_smart(
                request.text,
                min_length=request.min_length,
                max_length=request.max_length
            )
        elif request.method == "length":
            segments = segmenter.segment_by_length(
                request.text,
                target_length=(request.min_length + request.max_length) // 2
            )
        else:
            raise HTTPException(status_code=400, detail=f"Invalid method: {request.method}")

        return {
            "success": True,
            "method": request.method,
            "language": request.language,
            "segment_count": len(segments),
            "segments": segments
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")
