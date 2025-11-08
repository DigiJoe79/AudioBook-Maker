"""
Speaker Management API Endpoints

RESTful API for managing speakers and their voice samples.
"""
from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Form
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
async def list_speakers(db=Depends(get_db)):
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
        raise HTTPException(status_code=500, detail=str(e))


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
            raise HTTPException(status_code=400, detail="Invalid gender. Must be 'male', 'female', or 'neutral'")

        service = SpeakerService(db)
        speaker = service.create_speaker(request.dict())

        logger.info(f"Created speaker: {request.name}")

        # Emit SSE event
        await broadcaster.broadcast_speaker_update(
            {
                "speakerId": speaker["id"],
                "name": speaker["name"]
            },
            event_type=EventType.SPEAKER_CREATED
        )

        return speaker

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create speaker: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{speaker_id}", response_model=SpeakerResponse)
async def get_speaker(speaker_id: str, db=Depends(get_db)):
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
            raise HTTPException(status_code=404, detail=f"Speaker not found: {speaker_id}")

        logger.debug(f"Retrieved speaker: {speaker['name']}")

        return speaker

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get speaker {speaker_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
            raise HTTPException(status_code=400, detail="Invalid gender. Must be 'male', 'female', or 'neutral'")

        service = SpeakerService(db)

        # Check if speaker exists
        if not service.get_speaker(speaker_id):
            raise HTTPException(status_code=404, detail=f"Speaker not found: {speaker_id}")

        # Update only non-None fields
        update_data = {k: v for k, v in request.dict().items() if v is not None}

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
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{speaker_id}/set-default", response_model=SpeakerResponse)
async def set_default_speaker(speaker_id: str, db=Depends(get_db)):
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
            raise HTTPException(status_code=404, detail=f"Speaker not found: {speaker_id}")

        # Set speaker as default in speakers table
        updated_speaker = speaker_service.set_default_speaker(speaker_id)

        # Update settings.tts.defaultTtsSpeaker
        tts_settings = settings_service.get_setting('tts')
        if tts_settings:
            tts_settings['defaultTtsSpeaker'] = speaker['name']
            settings_service.update_setting('tts', tts_settings)
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
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/default/get", response_model=Optional[SpeakerResponse])
async def get_default_speaker(db=Depends(get_db)):
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
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{speaker_id}", response_model=DeleteResponse)
async def delete_speaker(speaker_id: str, db=Depends(get_db)):
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
            raise HTTPException(status_code=404, detail=f"Speaker not found: {speaker_id}")

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
        raise HTTPException(status_code=500, detail=str(e))


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
            raise HTTPException(status_code=404, detail=f"Speaker not found: {speaker_id}")

        # Validate file type
        if not file.filename.lower().endswith(('.wav', '.mp3')):
            raise HTTPException(status_code=400, detail="Only WAV and MP3 files are allowed")

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

        # Emit SSE event
        await broadcaster.broadcast_speaker_update(
            {
                "speakerId": speaker_id,
                "sampleId": sample["id"],
                "filename": sample["fileName"]
            },
            event_type=EventType.SPEAKER_SAMPLE_ADDED
        )

        return sample

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload sample for speaker {speaker_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))




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
            raise HTTPException(status_code=404, detail=f"Speaker not found: {speaker_id}")

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
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to delete sample: {e}")
        raise HTTPException(status_code=500, detail=str(e))
