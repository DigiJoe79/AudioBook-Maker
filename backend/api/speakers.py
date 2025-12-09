"""
Speaker Management API Endpoints

RESTful API for managing speakers and their voice samples.
"""
import sqlite3
from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Form
from fastapi.responses import FileResponse
from typing import List, Optional
from pathlib import Path
from pydantic import BaseModel, ConfigDict
import uuid
from loguru import logger

from db.database import get_db
from services.speaker_service import SpeakerService
from models.response_models import SpeakerResponse, SpeakerSampleResponse, DeleteResponse, to_camel
from services.event_broadcaster import broadcaster, EventType
from config import SPEAKER_SAMPLES_DIR


router = APIRouter(prefix="/api/speakers", tags=["speakers"])


# Request Models
class SpeakerCreateRequest(BaseModel):
    """Request model for creating a speaker"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    name: str
    description: Optional[str] = None
    gender: Optional[str] = None  # 'male', 'female', 'neutral'
    languages: List[str] = []
    tags: List[str] = []


class SpeakerUpdateRequest(BaseModel):
    """Request model for updating a speaker"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    name: Optional[str] = None
    description: Optional[str] = None
    gender: Optional[str] = None
    languages: Optional[List[str]] = None
    tags: Optional[List[str]] = None


@router.get("/", response_model=List[SpeakerResponse])
async def list_speakers(db: sqlite3.Connection = Depends(get_db)) -> list[SpeakerResponse]:
    """
    List all speakers with their samples

    Returns a list of all speakers including metadata and sample information.
    """
    try:
        service = SpeakerService(db)
        speakers = service.list_speakers()

        logger.debug(f"Listed {len(speakers)} speakers")

        return speakers

    except Exception as e:
        logger.error(f"Failed to list speakers: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_LIST_FAILED]error:{str(e)}")


@router.post("/", response_model=SpeakerResponse)
async def create_speaker(
    request: SpeakerCreateRequest,
    db=Depends(get_db)
):
    """
    Create a new speaker

    Creates a new speaker with metadata. Audio samples can be added separately.

    Args:
        request: Speaker data (name, description, gender, languages, tags)

    Returns:
        Created speaker
    """
    try:
        # Validate gender
        if request.gender and request.gender not in ['male', 'female', 'neutral']:
            raise HTTPException(status_code=400, detail="[SPEAKER_INVALID_GENDER]")

        service = SpeakerService(db)
        speaker = service.create_speaker(request.model_dump())

        logger.info(f"Created speaker: {request.name}")

        # Emit SSE event
        await broadcaster.broadcast_speaker_update(
            {
                "speakerId": speaker["id"],
                "name": speaker["name"]
            },
            event_type=EventType.SPEAKER_CREATED
        )

        # If this is the first speaker (and was set as default), emit settings.updated event
        if speaker["isDefault"]:
            from services.settings_service import SettingsService
            settings_service = SettingsService(db)
            tts_settings = settings_service.get_setting('tts')
            if tts_settings:
                await broadcaster.broadcast_settings_update({
                    "key": "tts",
                    "value": tts_settings
                })
                logger.info("Emitted settings.updated event for first speaker (default)")

        return speaker

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create speaker: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_CREATE_FAILED]error:{str(e)}")


@router.get("/{speaker_id}", response_model=SpeakerResponse)
async def get_speaker(speaker_id: str, db: sqlite3.Connection = Depends(get_db)) -> SpeakerResponse:
    """
    Get speaker details

    Returns full speaker information including all samples.

    Args:
        speaker_id: Speaker ID

    Returns:
        Speaker details
    """
    try:
        service = SpeakerService(db)
        speaker = service.get_speaker(speaker_id)

        if not speaker:
            raise HTTPException(status_code=404, detail=f"[SPEAKER_NOT_FOUND]speakerId:{speaker_id}")

        logger.debug(f"Retrieved speaker: {speaker['name']}")

        return speaker

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get speaker {speaker_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_GET_FAILED]speakerId:{speaker_id};error:{str(e)}")


@router.put("/{speaker_id}", response_model=SpeakerResponse)
async def update_speaker(
    speaker_id: str,
    request: SpeakerUpdateRequest,
    db=Depends(get_db)
):
    """
    Update speaker metadata

    Updates speaker information. Only provided fields will be updated.

    Args:
        speaker_id: Speaker ID
        request: Fields to update

    Returns:
        Updated speaker
    """
    try:
        # Validate gender if provided
        if request.gender and request.gender not in ['male', 'female', 'neutral']:
            raise HTTPException(status_code=400, detail="[SPEAKER_INVALID_GENDER]")

        service = SpeakerService(db)

        # Check if speaker exists
        if not service.get_speaker(speaker_id):
            raise HTTPException(status_code=404, detail=f"[SPEAKER_NOT_FOUND]speakerId:{speaker_id}")

        # Update only non-None fields
        update_data = {k: v for k, v in request.model_dump().items() if v is not None}

        speaker = service.update_speaker(speaker_id, update_data)

        logger.info(f"Updated speaker: {speaker_id}")

        # Emit SSE event
        await broadcaster.broadcast_speaker_update(
            {
                "speakerId": speaker["id"],
                "name": speaker["name"]
            },
            event_type=EventType.SPEAKER_UPDATED
        )

        return speaker

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update speaker {speaker_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_UPDATE_FAILED]speakerId:{speaker_id};error:{str(e)}")


@router.post("/{speaker_id}/set-default", response_model=SpeakerResponse)
async def set_default_speaker(speaker_id: str, db: sqlite3.Connection = Depends(get_db)) -> SpeakerResponse:
    """
    Set a speaker as the default

    Only one speaker can be default at a time.
    This will unset any other default speaker.
    Also updates settings.tts.defaultTtsSpeaker.

    Args:
        speaker_id: Speaker ID to set as default

    Returns:
        Updated speaker
    """
    try:
        from services.settings_service import SettingsService

        speaker_service = SpeakerService(db)
        settings_service = SettingsService(db)

        # Check if speaker exists
        speaker = speaker_service.get_speaker(speaker_id)
        if not speaker:
            raise HTTPException(status_code=404, detail=f"[SPEAKER_NOT_FOUND]speakerId:{speaker_id}")

        # Set speaker as default in speakers table
        updated_speaker = speaker_service.set_default_speaker(speaker_id)

        # Update settings.tts.defaultTtsSpeaker using dot-notation
        settings_service.update_nested_setting('tts.defaultTtsSpeaker', speaker['name'])
        logger.info(f"Updated settings.tts.defaultTtsSpeaker to '{speaker['name']}'")

        logger.info(f"Set default speaker: {speaker_id}")

        # Emit SSE event
        await broadcaster.broadcast_speaker_update(
            {
                "speakerId": updated_speaker["id"],
                "name": updated_speaker["name"]
            },
            event_type=EventType.SPEAKER_UPDATED
        )

        return updated_speaker

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to set default speaker {speaker_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_SET_DEFAULT_FAILED]speakerId:{speaker_id};error:{str(e)}")


@router.get("/default/get", response_model=Optional[SpeakerResponse])
async def get_default_speaker(db: sqlite3.Connection = Depends(get_db)) -> Optional[SpeakerResponse]:
    """
    Get the default speaker

    Returns:
        Default speaker or null if none set
    """
    try:
        service = SpeakerService(db)
        speaker = service.get_default_speaker()

        return speaker

    except Exception as e:
        logger.error(f"Failed to get default speaker: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_GET_DEFAULT_FAILED]error:{str(e)}")


@router.delete("/{speaker_id}", response_model=DeleteResponse)
async def delete_speaker(speaker_id: str, db: sqlite3.Connection = Depends(get_db)) -> DeleteResponse:
    """
    Delete speaker and all samples

    Permanently deletes a speaker including all audio samples and database records.

    Args:
        speaker_id: Speaker ID

    Returns:
        Status message
    """
    try:
        service = SpeakerService(db)

        # Check if speaker exists
        if not service.get_speaker(speaker_id):
            raise HTTPException(status_code=404, detail=f"[SPEAKER_NOT_FOUND]speakerId:{speaker_id}")

        result = service.delete_speaker(speaker_id)

        logger.info(f"Deleted speaker: {speaker_id}")

        # Emit SSE event
        await broadcaster.broadcast_speaker_update(
            {"speakerId": speaker_id},
            event_type=EventType.SPEAKER_DELETED
        )

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete speaker {speaker_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_DELETE_FAILED]speakerId:{speaker_id};error:{str(e)}")


@router.post("/{speaker_id}/samples", response_model=SpeakerSampleResponse)
async def upload_sample(
    speaker_id: str,
    file: UploadFile = File(...),
    transcript: Optional[str] = Form(None),
    db=Depends(get_db)
):
    """
    Upload audio sample for speaker

    Uploads a WAV or MP3 file as a voice sample for the speaker.
    Note: All samples are equal - no primary/secondary distinction.

    Args:
        speaker_id: Speaker ID
        file: Audio file (WAV or MP3)
        transcript: Optional text transcript of the audio

    Returns:
        Sample metadata
    """
    try:
        service = SpeakerService(db)

        # Check if speaker exists
        speaker = service.get_speaker(speaker_id)
        if not speaker:
            raise HTTPException(status_code=404, detail=f"[SPEAKER_NOT_FOUND]speakerId:{speaker_id}")

        # Validate file type
        if not file.filename.lower().endswith(('.wav', '.mp3')):
            raise HTTPException(status_code=400, detail="[SPEAKER_INVALID_FILE_TYPE]")

        # Create unique filename
        file_ext = Path(file.filename).suffix
        unique_filename = f"{uuid.uuid4()}{file_ext}"

        # Save file to speaker's directory
        speaker_dir = Path(SPEAKER_SAMPLES_DIR) / speaker_id
        speaker_dir.mkdir(parents=True, exist_ok=True)
        file_path = speaker_dir / unique_filename

        # Write file
        content = await file.read()
        with open(file_path, 'wb') as f:
            f.write(content)

        # Add sample to database (pass original filename separately)
        sample = service.add_sample(
            speaker_id=speaker_id,
            file_path=file_path,
            original_filename=file.filename,
            transcript=transcript
        )

        logger.info(f"Uploaded sample for speaker {speaker_id}: {file.filename}")

        # Emit SSE event for sample added
        await broadcaster.broadcast_speaker_update(
            {
                "speakerId": speaker_id,
                "sampleId": sample["id"],
                "filename": sample["fileName"]
            },
            event_type=EventType.SPEAKER_SAMPLE_ADDED
        )

        # Check if speaker was just activated (first sample)
        updated_speaker = service.get_speaker(speaker_id)
        if updated_speaker and updated_speaker["isActive"]:
            # Emit speaker.updated event to notify frontend about activation
            await broadcaster.broadcast_speaker_update(
                {
                    "speakerId": speaker_id,
                    "name": updated_speaker["name"]
                },
                event_type=EventType.SPEAKER_UPDATED
            )

        return sample

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload sample for speaker {speaker_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_SAMPLE_ADD_FAILED]speakerId:{speaker_id};error:{str(e)}")




@router.get("/{speaker_id}/samples/{sample_id}/audio")
async def get_sample_audio(
    speaker_id: str,
    sample_id: str,
    db=Depends(get_db)
) -> FileResponse:
    """
    Get speaker sample audio file

    Streams the audio file for a specific speaker sample.

    Args:
        speaker_id: Speaker ID
        sample_id: Sample ID

    Returns:
        Audio file (WAV or MP3)
    """
    try:
        service = SpeakerService(db)

        # Get speaker to verify it exists
        speaker = service.get_speaker(speaker_id)
        if not speaker:
            raise HTTPException(status_code=404, detail=f"[SPEAKER_NOT_FOUND]speakerId:{speaker_id}")

        # Find the sample
        sample = next((s for s in speaker["samples"] if s["id"] == sample_id), None)
        if not sample:
            raise HTTPException(status_code=404, detail=f"[SPEAKER_SAMPLE_NOT_FOUND]sampleId:{sample_id}")

        # Reconstruct full path from relative path stored in DB
        sample_path = Path(SPEAKER_SAMPLES_DIR) / sample["filePath"]
        if not sample_path.exists():
            logger.error(f"Sample file not found: {sample_path}")
            raise HTTPException(status_code=404, detail="[SPEAKER_SAMPLE_FILE_NOT_FOUND]")

        # Determine media type based on file extension
        media_type = "audio/wav" if sample_path.suffix.lower() == ".wav" else "audio/mpeg"

        logger.debug(f"Serving sample audio: {sample_id} for speaker {speaker_id}")

        return FileResponse(
            path=str(sample_path),
            media_type=media_type,
            filename=sample["fileName"]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get sample audio {sample_id} for speaker {speaker_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_SAMPLE_GET_FAILED]speakerId:{speaker_id};sampleId:{sample_id};error:{str(e)}")


@router.delete("/{speaker_id}/samples/{sample_id}", response_model=DeleteResponse)
async def delete_sample(
    speaker_id: str,
    sample_id: str,
    db=Depends(get_db)
):
    """
    Delete speaker sample

    Permanently deletes an audio sample file and database record.

    Args:
        speaker_id: Speaker ID
        sample_id: Sample ID

    Returns:
        Status message
    """
    try:
        service = SpeakerService(db)

        # Check if speaker exists
        if not service.get_speaker(speaker_id):
            raise HTTPException(status_code=404, detail=f"[SPEAKER_NOT_FOUND]speakerId:{speaker_id}")

        result = service.delete_sample(speaker_id, sample_id)

        logger.info(f"Deleted sample {sample_id} from speaker {speaker_id}")

        # Emit SSE event
        await broadcaster.broadcast_speaker_update(
            {
                "speakerId": speaker_id,
                "sampleId": sample_id
            },
            event_type=EventType.SPEAKER_SAMPLE_DELETED
        )

        return result

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=f"[SPEAKER_SAMPLE_NOT_FOUND]sampleId:{sample_id};error:{str(e)}")
    except Exception as e:
        logger.error(f"Failed to delete sample: {e}")
        raise HTTPException(status_code=500, detail=f"[SPEAKER_SAMPLE_DELETE_FAILED]speakerId:{speaker_id};sampleId:{sample_id};error:{str(e)}")
