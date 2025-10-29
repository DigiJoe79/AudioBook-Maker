"""
TTS (Text-to-Speech) generation endpoints
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, ConfigDict
from typing import Dict, Any, Optional
from pathlib import Path
import sqlite3
import uuid
from loguru import logger

from db.database import get_db
from db.repositories import SegmentRepository
from services.tts_manager import get_tts_manager
from models.response_models import (
    EnginesListResponse,
    EngineInitializeResponse,
    ModelsListResponse,
    TTSGenerationResponse,
    TTSProgressResponse,
    ChapterGenerationStartResponse,
    ChapterGenerationCancelResponse,
    GenerationStatusResponse,
    to_camel
)
from config import OUTPUT_DIR

router = APIRouter()

generation_jobs: Dict[str, Dict[str, Any]] = {}


def file_path_to_url(file_path: str, base_url: str = "http://localhost:8765") -> str:
    """
    Convert a file system path to HTTP URL

    Args:
        file_path: Absolute file system path
        base_url: Base URL of the API server

    Returns:
        HTTP URL to access the file
    """
    filename = Path(file_path).name
    return f"{base_url}/audio/{filename}"


class TTSOptions(BaseModel):
    """TTS generation options (optional overrides)"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    temperature: Optional[float] = None
    length_penalty: Optional[float] = None
    repetition_penalty: Optional[float] = None
    top_k: Optional[int] = None
    top_p: Optional[float] = None
    speed: Optional[float] = None


class GenerateChapterRequest(BaseModel):
    """Request to generate entire chapter"""
    model_config = ConfigDict(
        protected_namespaces=(),
        alias_generator=to_camel,
        populate_by_name=True
    )

    chapter_id: str
    speaker: str
    language: str
    engine: str
    model_name: str
    force_regenerate: bool = False
    options: Optional[TTSOptions] = None


@router.get("/engines", response_model=EnginesListResponse)
async def list_engines():
    """
    Get list of available TTS engines

    Returns engine metadata including supported languages, constraints,
    and current load status.
    """
    try:
        manager = get_tts_manager()

        engines = []
        for engine_type in manager.list_available_engines():
            engine_class = manager._engine_classes[engine_type]

            engine_info = {
                'name': engine_class.get_engine_name_static(),
                'display_name': engine_class.get_display_name_static(),
                'supported_languages': engine_class.get_supported_languages_static(),
                'default_parameters': engine_class.get_default_parameters_static(),
                'constraints': engine_class.get_generation_constraints_static(),
                'model_loaded': engine_type in manager._engines,
                'device': 'cuda'
            }

            engines.append(engine_info)

        return {
            "success": True,
            "engines": engines,
            "count": len(engines)
        }
    except Exception as e:
        logger.error(f"Failed to list engines: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/engines/{engine_type}/models", response_model=ModelsListResponse)
async def list_engine_models(engine_type: str):
    """
    Get list of available models for a specific engine

    Args:
        engine_type: Engine identifier (e.g., 'xtts', 'dummy')

    Returns:
        List of available models with metadata
    """
    try:
        manager = get_tts_manager()

        if engine_type not in manager.list_available_engines():
            raise HTTPException(
                status_code=400,
                detail=f"Unknown engine type: {engine_type}. Available engines: {manager.list_available_engines()}"
            )

        backend_root = Path(__file__).parent.parent
        models_base_path = backend_root / "models"

        models = manager.get_available_models(engine_type, models_base_path)

        return {
            "success": True,
            "engine": engine_type,
            "models": models,
            "count": len(models)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list models for engine {engine_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class InitializeEngineRequest(BaseModel):
    """Request to initialize an engine with specific model"""
    model_config = ConfigDict(
        protected_namespaces=(),
        alias_generator=to_camel,
        populate_by_name=True
    )

    model_name: str


@router.post("/engines/{engine_type}/initialize", response_model=EngineInitializeResponse)
async def initialize_engine(engine_type: str, request: InitializeEngineRequest):
    """
    Initialize a specific TTS engine with a specific model

    Args:
        engine_type: Engine identifier (e.g., 'xtts', 'dummy')
        request: Initialization request with model_name

    Returns:
        Engine info including languages, constraints, and parameters
    """
    try:
        manager = get_tts_manager()

        if engine_type not in manager.list_available_engines():
            raise HTTPException(
                status_code=400,
                detail=f"Unknown engine type: {engine_type}. Available engines: {manager.list_available_engines()}"
            )

        backend_root = Path(__file__).parent.parent
        models_base_path = backend_root / "models"

        engine = manager.initialize_engine(
            engine_type,
            model_name=request.model_name,
            models_base_path=models_base_path
        )

        return {
            "success": True,
            "engine": engine.get_engine_name(),
            "display_name": engine.get_display_name(),
            "model_name": request.model_name,
            "languages": engine.get_supported_languages(),
            "constraints": engine.get_generation_constraints(),
            "default_parameters": engine.get_default_parameters(),
            "model_loaded": engine.model_loaded
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to initialize engine {engine_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-segment/{segment_id}", response_model=TTSGenerationResponse)
async def generate_segment_by_id(
    segment_id: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Regenerate audio for a segment using its stored parameters

    All parameters (engine, model, speaker, language) are loaded from the segment in the database.
    TTS parameters (temperature, speed, etc.) are loaded from settings for the segment's engine.
    """
    try:
        from services.settings_service import SettingsService

        segment_repo = SegmentRepository(conn)
        settings_service = SettingsService(conn)

        segment = segment_repo.get_by_id(segment_id)
        if not segment:
            raise HTTPException(status_code=404, detail="Segment not found")

        engine_type = segment.get('engine')
        model_name = segment.get('model_name')
        speaker = segment.get('speaker_name')
        language = segment.get('language')

        if not all([engine_type, model_name, speaker, language]):
            raise HTTPException(
                status_code=400,
                detail="Segment missing required parameters (engine, model, speaker, or language)"
            )

        if segment.get('audio_path'):
            try:
                audio_url = segment['audio_path']
                if '/audio/' in audio_url:
                    filename = audio_url.split('/audio/')[-1]
                    audio_file = Path(OUTPUT_DIR) / filename

                    if audio_file.exists():
                        import os
                        os.remove(audio_file)
                        logger.info(f"Deleted old audio file: {audio_file}")
            except Exception as e:
                logger.warning(f"Could not delete old audio file for segment {segment_id}: {e}")

        segment_repo.update(segment_id, status="processing")

        manager = get_tts_manager()

        backend_root = Path(__file__).parent.parent
        models_base_path = backend_root / "models"

        if engine_type not in manager._engines:
            logger.info(f"Initializing engine {engine_type} with model {model_name}")
            manager.initialize_engine(
                engine_type,
                model_name=model_name,
                models_base_path=models_base_path
            )

        engine = manager.get_engine(engine_type)

        engine_parameters = settings_service.get_engine_parameters(engine_type)

        output_filename = f"segment_{segment_id}_{uuid.uuid4().hex[:8]}.wav"
        output_path = engine.output_folder / output_filename

        audio_path = engine.generate(
            text=segment['text'],
            language=language,
            speaker_name=speaker,
            output_path=str(output_path),
            **engine_parameters
        )

        import torchaudio
        waveform, sample_rate = torchaudio.load(audio_path)
        duration = waveform.shape[1] / sample_rate

        audio_url = file_path_to_url(audio_path)

        updated_segment = segment_repo.update(
            segment_id,
            audio_path=audio_url,
            start_time=0.0,
            end_time=float(duration),
            status="completed"
        )

        return {
            "success": True,
            "segment": updated_segment,
            "message": f"Segment audio regenerated successfully using {engine_type}"
        }

    except Exception as e:
        logger.error(f"Failed to generate segment {segment_id}: {e}")
        try:
            segment_repo.update(segment_id, status="failed")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e))


def generate_chapter_task(
    chapter_id: str,
    speaker: str,
    language: str,
    engine: str,
    model_name: str,
    force_regenerate: bool,
    options: Optional[TTSOptions]
):
    """
    Background task to generate all segments for a chapter

    Parameters (speaker, language, engine, model) are applied to all segments.
    TTS parameters are loaded from settings, with optional overrides from options.
    """
    from db.database import get_db_connection_simple
    from services.settings_service import SettingsService
    from services.health_monitor import get_health_monitor

    health_monitor = get_health_monitor()
    health_monitor.increment_active_jobs()

    try:
        conn = get_db_connection_simple()
        segment_repo = SegmentRepository(conn)
        settings_service = SettingsService(conn)
        manager = get_tts_manager()

        segments = segment_repo.get_by_chapter(chapter_id)

        if not segments:
            generation_jobs[chapter_id]["status"] = "completed"
            generation_jobs[chapter_id]["error"] = "No segments found"
            return

        total = len(segments)
        generation_jobs[chapter_id]["total"] = total

        backend_root = Path(__file__).parent.parent
        models_base_path = backend_root / "models"

        if engine not in manager._engines:
            logger.info(f"Initializing engine {engine} with model {model_name}")
            manager.initialize_engine(
                engine,
                model_name=model_name,
                models_base_path=models_base_path
            )

        engine_instance = manager.get_engine(engine)

        settings_params = settings_service.get_engine_parameters(engine)

        if options:
            override_dict = options.model_dump(exclude_unset=True, exclude_none=True)
            final_params = {**settings_params, **override_dict}
            logger.info(f"Using settings parameters with overrides: {override_dict}")
        else:
            final_params = settings_params
            logger.info(f"Using settings parameters: {final_params}")

        for idx, segment in enumerate(segments):
            segment_id = segment['id']
            generation_jobs[chapter_id]["current_segment"] = segment_id

            try:
                segment_type = segment.get('segment_type', 'standard')

                if segment_type == 'divider':
                    logger.info(f"Skipping divider segment {segment_id} (no TTS needed)")
                    generation_jobs[chapter_id]["progress"] = idx + 1
                    continue

                if not force_regenerate and segment['status'] == 'completed' and segment['audio_path']:
                    logger.info(f"Skipping already generated segment {segment_id}")
                    generation_jobs[chapter_id]["progress"] = idx + 1
                    continue

                if force_regenerate and segment.get('audio_path'):
                    try:
                        audio_url = segment['audio_path']
                        if '/audio/' in audio_url:
                            filename = audio_url.split('/audio/')[-1]
                            audio_file = engine_instance.output_folder / filename
                            if audio_file.exists():
                                import os
                                os.remove(audio_file)
                                logger.info(f"Deleted old audio file for regeneration: {audio_file}")
                    except Exception as e:
                        logger.warning(f"Could not delete old audio file for segment {segment_id}: {e}")

                segment_repo.update(segment_id, status="processing")

                output_filename = f"segment_{segment_id}_{uuid.uuid4().hex[:8]}.wav"
                output_path = engine_instance.output_folder / output_filename

                audio_path = engine_instance.generate(
                    text=segment['text'],
                    language=language,
                    speaker_name=speaker,
                    output_path=str(output_path),
                    **final_params
                )

                import torchaudio
                waveform, sample_rate = torchaudio.load(audio_path)
                duration = waveform.shape[1] / sample_rate

                audio_url = file_path_to_url(audio_path)

                segment_repo.update(
                    segment_id,
                    audio_path=audio_url,
                    start_time=0.0,
                    end_time=float(duration),
                    status="completed",
                    engine=engine,
                    model_name=model_name,
                    speaker_name=speaker,
                    language=language
                )

                logger.info(f"Generated segment {idx+1}/{total}: {segment_id} using {engine}")

                generation_jobs[chapter_id]["progress"] = idx + 1

            except Exception as e:
                logger.error(f"Failed to generate segment {segment_id}: {e}")
                segment_repo.update(segment_id, status="failed")
                generation_jobs[chapter_id]["errors"] = generation_jobs[chapter_id].get("errors", [])
                generation_jobs[chapter_id]["errors"].append({
                    "segment_id": segment_id,
                    "error": str(e)
                })
                generation_jobs[chapter_id]["progress"] = idx + 1

        generation_jobs[chapter_id]["status"] = "completed"
        generation_jobs[chapter_id]["progress"] = total

        conn.close()

    except Exception as e:
        logger.error(f"Chapter generation failed: {e}")
        generation_jobs[chapter_id]["status"] = "failed"
        generation_jobs[chapter_id]["error"] = str(e)
    finally:
        health_monitor.decrement_active_jobs()


@router.post("/generate-chapter", response_model=ChapterGenerationStartResponse)
async def generate_chapter(
    request: GenerateChapterRequest,
    background_tasks: BackgroundTasks
):
    """
    Generate audio for an entire chapter (batch operation)
    """
    chapter_id = request.chapter_id

    if chapter_id in generation_jobs and generation_jobs[chapter_id]["status"] == "running":
        return {
            "status": "already_running",
            "chapter_id": chapter_id,
            "progress": generation_jobs[chapter_id].get("progress", 0)
        }

    generation_jobs[chapter_id] = {
        "status": "running",
        "progress": 0,
        "total": 0,
        "current_segment": None,
        "errors": [],
        "engine": request.engine
    }

    background_tasks.add_task(
        generate_chapter_task,
        chapter_id,
        request.speaker,
        request.language,
        request.engine,
        request.model_name,
        request.force_regenerate,
        request.options
    )

    logger.info(f"Started chapter generation for chapter {chapter_id} using engine {request.engine} with model {request.model_name}")

    return {
        "status": "started",
        "chapter_id": chapter_id,
        "engine": request.engine,
        "message": f"Chapter generation started in background using {request.engine}"
    }


@router.get("/generate-chapter/{chapter_id}/progress", response_model=TTSProgressResponse)
async def get_generation_progress(chapter_id: str):
    """
    Get progress of a chapter generation job
    """
    if chapter_id not in generation_jobs:
        return {
            "chapter_id": chapter_id,
            "status": "not_found",
            "progress": 0.0,
            "current_segment": 0,
            "total_segments": 0,
            "message": "Generation job not found"
        }

    job = generation_jobs[chapter_id]
    total = job.get("total", 0)
    current = job.get("progress", 0)

    return {
        "chapter_id": chapter_id,
        "status": job.get("status", "unknown"),
        "progress": (current / total) if total > 0 else 0.0,
        "current_segment": current,
        "total_segments": total,
        "message": f"Processing segment {current} of {total}",
        "error": job.get("error")
    }


@router.delete("/generate-chapter/{chapter_id}", response_model=ChapterGenerationCancelResponse)
async def cancel_generation(chapter_id: str):
    """
    Cancel a running generation job
    """
    if chapter_id in generation_jobs:
        generation_jobs[chapter_id]["status"] = "cancelled"
        return {"status": "cancelled", "chapter_id": chapter_id}

    return {"status": "not_found", "chapter_id": chapter_id}


@router.get("/generation-status", response_model=GenerationStatusResponse)
async def get_generation_status():
    """
    Get status of all active generation jobs (lightweight endpoint for fast polling).

    This endpoint is optimized for high-frequency polling (250-500ms intervals).
    It only returns in-memory job data without any database queries, making it
    extremely fast (<0.1ms response time).

    Designed for real-time UI updates during TTS generation.

    Returns:
        GenerationStatusResponse: Map of chapter IDs to their job status
    """
    import time

    active_jobs = {}

    for chapter_id, job in generation_jobs.items():
        status = job.get("status", "unknown")

        if status == "running":
            active_jobs[chapter_id] = {
                "status": status,
                "progress": job.get("progress", 0),
                "total": job.get("total", 0),
                "current_segment": job.get("current_segment"),
                "errors": len(job.get("errors", [])),
                "updated_at": time.time()
            }
        elif status in ("completed", "failed", "cancelled"):
            active_jobs[chapter_id] = {
                "status": status,
                "progress": job.get("progress", 0),
                "total": job.get("total", 0),
                "current_segment": job.get("current_segment"),
                "errors": len(job.get("errors", [])),
                "updated_at": time.time()
            }

    return {"active_jobs": active_jobs}
