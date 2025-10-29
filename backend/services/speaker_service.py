"""
Speaker Service

Handles speaker management including metadata and audio samples.
Speakers are stored in the database with their samples in the filesystem.
"""
import json
import uuid
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from loguru import logger

from config import SPEAKER_SAMPLES_DIR

try:
    import wave
    WAVE_SUPPORT = True
except ImportError:
    WAVE_SUPPORT = False
    logger.warning("wave module not available, audio metadata extraction disabled")


class SpeakerService:
    """
    Service for managing speakers and their voice samples

    Architecture:
    - Database stores speaker metadata
    - Filesystem stores WAV samples ({SPEAKER_SAMPLES_DIR}/{speaker_id}/)
    - Each speaker can have 1-n samples
    """

    def __init__(self, db, samples_folder: str = SPEAKER_SAMPLES_DIR):
        """
        Initialize speaker service

        Args:
            db: Database connection
            samples_folder: Base folder for speaker samples
        """
        self.db = db
        self.samples_folder = Path(samples_folder)
        self.samples_folder.mkdir(parents=True, exist_ok=True)

    def list_speakers(self) -> List[Dict[str, Any]]:
        """
        List all speakers with their samples

        Returns:
            List of speaker dictionaries with samples
        """
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT id, name, description, gender, languages, tags, is_active, is_default, created_at, updated_at
            FROM speakers
            ORDER BY name
        """)

        speakers = []
        for row in cursor.fetchall():
            speaker = {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "gender": row[3],
                "languages": json.loads(row[4]) if row[4] else [],
                "tags": json.loads(row[5]) if row[5] else [],
                "isActive": bool(row[6]),
                "isDefault": bool(row[7]),
                "createdAt": row[8],
                "updatedAt": row[9],
                "samples": self._get_speaker_samples(row[0])
            }
            speakers.append(speaker)

        logger.debug(f"Listed {len(speakers)} speakers")
        return speakers

    def get_speaker(self, speaker_id: str) -> Optional[Dict[str, Any]]:
        """
        Get speaker details with all samples

        Args:
            speaker_id: Speaker ID

        Returns:
            Speaker dictionary or None if not found
        """
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT id, name, description, gender, languages, tags, is_active, is_default, created_at, updated_at
            FROM speakers
            WHERE id = ?
        """, (speaker_id,))

        row = cursor.fetchone()
        if not row:
            return None

        speaker = {
            "id": row[0],
            "name": row[1],
            "description": row[2],
            "gender": row[3],
            "languages": json.loads(row[4]) if row[4] else [],
            "tags": json.loads(row[5]) if row[5] else [],
            "isActive": bool(row[6]),
            "isDefault": bool(row[7]),
            "createdAt": row[8],
            "updatedAt": row[9],
            "samples": self._get_speaker_samples(row[0])
        }

        logger.debug(f"Retrieved speaker: {speaker['name']}")
        return speaker

    def get_speaker_by_name(self, speaker_name: str) -> Optional[Dict[str, Any]]:
        """
        Get speaker details by name

        Args:
            speaker_name: Speaker name

        Returns:
            Speaker dictionary or None if not found
        """
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT id, name, description, gender, languages, tags, is_active, is_default, created_at, updated_at
            FROM speakers
            WHERE name = ?
        """, (speaker_name,))

        row = cursor.fetchone()
        if not row:
            return None

        speaker = {
            "id": row[0],
            "name": row[1],
            "description": row[2],
            "gender": row[3],
            "languages": json.loads(row[4]) if row[4] else [],
            "tags": json.loads(row[5]) if row[5] else [],
            "isActive": bool(row[6]),
            "isDefault": bool(row[7]),
            "createdAt": row[8],
            "updatedAt": row[9],
            "samples": self._get_speaker_samples(row[0])
        }

        logger.debug(f"Retrieved speaker by name: {speaker['name']}")
        return speaker

    def _get_speaker_samples(self, speaker_id: str) -> List[Dict[str, Any]]:
        """Get all samples for a speaker"""
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT id, file_name, file_path, file_size, duration, sample_rate,
                   transcript, created_at
            FROM speaker_samples
            WHERE speaker_id = ?
            ORDER BY created_at ASC
        """, (speaker_id,))

        samples = []
        for row in cursor.fetchall():
            sample = {
                "id": row[0],
                "fileName": row[1],
                "filePath": row[2],
                "fileSize": row[3],
                "duration": row[4],
                "sampleRate": row[5],
                "transcript": row[6],
                "createdAt": row[7]
            }
            samples.append(sample)

        return samples

    def create_speaker(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a new speaker

        If this is the first speaker, it will automatically be set as default.

        Args:
            data: Speaker data
                - name (required)
                - description (optional)
                - gender (optional): 'male', 'female', 'neutral'
                - languages (optional): List of language codes
                - tags (optional): List of tags

        Returns:
            Created speaker
        """
        speaker_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        cursor = self.db.cursor()

        cursor.execute("SELECT COUNT(*) FROM speakers")
        speaker_count = cursor.fetchone()[0]
        is_first_speaker = speaker_count == 0

        cursor.execute("""
            INSERT INTO speakers (id, name, description, gender, languages, tags, is_active, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            speaker_id,
            data["name"],
            data.get("description"),
            data.get("gender"),
            json.dumps(data.get("languages", [])),
            json.dumps(data.get("tags", [])),
            False,
            is_first_speaker,
            now,
            now
        ))

        self.db.commit()

        speaker_dir = self.samples_folder / speaker_id
        speaker_dir.mkdir(parents=True, exist_ok=True)

        if is_first_speaker:
            from services.settings_service import SettingsService
            settings_service = SettingsService(self.db)
            tts_settings = settings_service.get_setting('tts')
            if tts_settings:
                tts_settings['defaultSpeaker'] = data['name']
                settings_service.update_setting('tts', tts_settings)
                logger.info(f"Created FIRST speaker (set as default): {data['name']} ({speaker_id}), updated settings.tts.defaultSpeaker")
            else:
                logger.info(f"Created FIRST speaker (set as default): {data['name']} ({speaker_id})")
        else:
            logger.info(f"Created speaker: {data['name']} ({speaker_id})")

        return self.get_speaker(speaker_id)

    def update_speaker(self, speaker_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update speaker metadata

        Args:
            speaker_id: Speaker ID
            data: Fields to update

        Returns:
            Updated speaker
        """
        fields = []
        values = []

        for key in ["name", "description", "gender"]:
            if key in data:
                fields.append(f"{key} = ?")
                values.append(data[key])

        for key in ["languages", "tags"]:
            if key in data:
                fields.append(f"{key} = ?")
                values.append(json.dumps(data[key]))

        if not fields:
            return self.get_speaker(speaker_id)

        fields.append("updated_at = ?")
        values.append(datetime.utcnow().isoformat())

        values.append(speaker_id)

        cursor = self.db.cursor()
        cursor.execute(f"""
            UPDATE speakers
            SET {', '.join(fields)}
            WHERE id = ?
        """, values)

        self.db.commit()

        logger.info(f"Updated speaker: {speaker_id}")

        return self.get_speaker(speaker_id)

    def delete_speaker(self, speaker_id: str) -> Dict[str, str]:
        """
        Delete speaker and all associated samples

        Args:
            speaker_id: Speaker ID

        Returns:
            Status message
        """
        speaker = self.get_speaker(speaker_id)
        if not speaker:
            raise ValueError(f"Speaker not found: {speaker_id}")

        cursor = self.db.cursor()
        cursor.execute("DELETE FROM speakers WHERE id = ?", (speaker_id,))
        self.db.commit()

        speaker_dir = self.samples_folder / speaker_id
        if speaker_dir.exists():
            shutil.rmtree(speaker_dir)

        logger.info(f"Deleted speaker: {speaker['name']} ({speaker_id})")

        return {"status": "success", "message": f"Speaker '{speaker['name']}' deleted"}

    def add_sample(
        self,
        speaker_id: str,
        file_path: Path,
        original_filename: Optional[str] = None,
        transcript: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Add audio sample to speaker

        Note: All samples are equal - no primary/secondary distinction.

        Args:
            speaker_id: Speaker ID
            file_path: Path to uploaded WAV file (with UUID filename)
            original_filename: Original filename from upload (optional, defaults to file_path.name)
            transcript: Optional text transcript

        Returns:
            Sample metadata
        """
        sample_id = str(uuid.uuid4())
        file_name = original_filename if original_filename else file_path.name
        file_size = file_path.stat().st_size

        duration = None
        sample_rate = None
        if WAVE_SUPPORT and file_path.suffix.lower() == '.wav':
            try:
                with wave.open(str(file_path), 'r') as wav:
                    frames = wav.getnframes()
                    rate = wav.getframerate()
                    duration = frames / float(rate)
                    sample_rate = rate
            except Exception as e:
                logger.warning(f"Could not extract audio metadata from {file_name}: {e}")
                logger.info(f"Continuing without metadata for sample {file_name}")

        cursor = self.db.cursor()
        cursor.execute("""
            INSERT INTO speaker_samples
            (id, speaker_id, file_name, file_path, file_size, duration, sample_rate, transcript, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            sample_id,
            speaker_id,
            file_name,
            str(file_path),
            file_size,
            duration,
            sample_rate,
            transcript,
            datetime.utcnow().isoformat()
        ))

        self.db.commit()

        cursor.execute("SELECT COUNT(*) FROM speaker_samples WHERE speaker_id = ?", (speaker_id,))
        sample_count = cursor.fetchone()[0]
        if sample_count == 1:
            cursor.execute("""
                UPDATE speakers
                SET is_active = TRUE, updated_at = ?
                WHERE id = ?
            """, (datetime.utcnow().isoformat(), speaker_id))
            self.db.commit()
            logger.info(f"Speaker {speaker_id} activated (first sample added)")

        logger.info(f"Added sample to speaker {speaker_id}: {file_name}")

        return {
            "id": sample_id,
            "fileName": file_name,
            "filePath": str(file_path),
            "fileSize": file_size,
            "duration": duration,
            "sampleRate": sample_rate,
            "transcript": transcript,
            "createdAt": datetime.utcnow().isoformat()
        }

    def delete_sample(self, speaker_id: str, sample_id: str) -> Dict[str, str]:
        """
        Delete audio sample

        Args:
            speaker_id: Speaker ID
            sample_id: Sample ID

        Returns:
            Status message
        """
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT file_path
            FROM speaker_samples
            WHERE id = ? AND speaker_id = ?
        """, (sample_id, speaker_id))

        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Sample not found: {sample_id}")

        file_path = Path(row[0])

        cursor.execute("DELETE FROM speaker_samples WHERE id = ?", (sample_id,))
        self.db.commit()

        if file_path.exists():
            file_path.unlink()

        cursor.execute("SELECT COUNT(*) FROM speaker_samples WHERE speaker_id = ?", (speaker_id,))
        sample_count = cursor.fetchone()[0]
        if sample_count == 0:
            cursor.execute("""
                UPDATE speakers
                SET is_active = FALSE, updated_at = ?
                WHERE id = ?
            """, (datetime.utcnow().isoformat(), speaker_id))
            self.db.commit()
            logger.info(f"Speaker {speaker_id} deactivated (no samples remaining)")

        logger.info(f"Deleted sample {sample_id} from speaker {speaker_id}")

        return {"status": "success", "message": "Sample deleted"}


    def set_default_speaker(self, speaker_id: str) -> Dict[str, Any]:
        """
        Set a speaker as the default

        Only one speaker can be default at a time.
        This will unset any other default speaker.

        Args:
            speaker_id: Speaker ID to set as default

        Returns:
            Updated speaker
        """
        cursor = self.db.cursor()
        now = datetime.utcnow().isoformat()

        cursor.execute("UPDATE speakers SET is_default = FALSE")

        cursor.execute("""
            UPDATE speakers
            SET is_default = TRUE, updated_at = ?
            WHERE id = ?
        """, (now, speaker_id))

        self.db.commit()

        logger.info(f"Set speaker {speaker_id} as default")

        return self.get_speaker(speaker_id)

    def get_default_speaker(self) -> Optional[Dict[str, Any]]:
        """
        Get the default speaker

        Returns:
            Default speaker or None if no default set
        """
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT id, name, description, gender, languages, tags, is_active, is_default, created_at, updated_at
            FROM speakers
            WHERE is_default = TRUE
            LIMIT 1
        """)

        row = cursor.fetchone()
        if not row:
            logger.debug("No default speaker set")
            return None

        speaker = {
            "id": row[0],
            "name": row[1],
            "description": row[2],
            "gender": row[3],
            "languages": json.loads(row[4]) if row[4] else [],
            "tags": json.loads(row[5]) if row[5] else [],
            "isActive": bool(row[6]),
            "isDefault": bool(row[7]),
            "createdAt": row[8],
            "updatedAt": row[9],
            "samples": self._get_speaker_samples(row[0])
        }

        logger.debug(f"Retrieved default speaker: {speaker['name']}")
        return speaker
