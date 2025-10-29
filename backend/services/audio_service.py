"""
Audio processing service for merging segments and format conversion
"""
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import urllib.parse
import subprocess
from pydub import AudioSegment
from loguru import logger

from config import OUTPUT_DIR, EXPORTS_DIR


class AudioService:
    """Service for audio processing operations"""

    def __init__(self, output_dir: str = OUTPUT_DIR):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)

        self.export_dir = Path(EXPORTS_DIR)
        self.export_dir.mkdir(exist_ok=True)

    def url_to_local_path(self, url: str) -> Path:
        """Convert HTTP URL to local file path"""
        parsed = urllib.parse.urlparse(url)
        path_parts = parsed.path.strip('/').split('/')

        if 'exports' in path_parts:
            exports_index = path_parts.index('exports')
            filename = '/'.join(path_parts[exports_index + 1:])
            local_path = self.export_dir / filename
        elif 'audio' in path_parts:
            audio_index = path_parts.index('audio')
            filename = '/'.join(path_parts[audio_index + 1:])
            local_path = self.output_dir / filename
        else:
            filename = path_parts[-1]
            local_path = self.output_dir / filename

        if not local_path.exists():
            raise FileNotFoundError(f"Audio file not found: {local_path}")

        return local_path

    def merge_segments_to_file(
        self,
        segments: List[Dict[str, Any]],
        output_filename: str,
        pause_ms: int = 500,
        progress_callback: Optional[callable] = None
    ) -> Tuple[Path, float]:
        """
        Merge multiple audio segments into a single file with pauses

        Supports two segment types:
        - standard: Regular audio segments (with audio_path)
        - divider: Pause/scene breaks (with pause_duration, no audio)

        Args:
            segments: List of segment dictionaries with 'audio_path' and/or 'segment_type' fields
            output_filename: Name for the output file (without extension)
            pause_ms: Default pause duration between standard segments in milliseconds
            progress_callback: Optional callback for progress updates

        Returns:
            Tuple of (output_path, total_duration_seconds)
        """
        if not segments:
            raise ValueError("No segments to merge")

        logger.info(f"Merging {len(segments)} segments (standard + dividers) with {pause_ms}ms pause")

        combined = AudioSegment.empty()

        for i, segment in enumerate(segments):
            try:
                segment_type = segment.get('segment_type', 'standard')

                if segment_type == 'divider':
                    pause_duration = segment.get('pause_duration', 2000)
                    logger.debug(f"Adding divider pause: {pause_duration}ms")
                    silence = AudioSegment.silent(duration=pause_duration)
                    combined += silence

                elif segment_type == 'standard':
                    if not segment.get('audio_path'):
                        logger.warning(f"Skipping standard segment {segment.get('id')} without audio")
                        continue

                    if segment.get('status') != 'completed':
                        logger.warning(f"Skipping incomplete segment {segment.get('id')}")
                        continue

                    local_path = self.url_to_local_path(segment['audio_path'])

                    audio = AudioSegment.from_file(str(local_path))
                    combined += audio

                    if i < len(segments) - 1 and pause_ms > 0:
                        silence = AudioSegment.silent(duration=pause_ms)
                        combined += silence
                        logger.debug(f"Added {pause_ms}ms pause after standard segment")

                if progress_callback:
                    progress_callback(i + 1, len(segments))

            except Exception as e:
                logger.error(f"Failed to process segment {i} (type: {segment.get('segment_type')}): {e}")
                continue

        if len(combined) == 0:
            raise ValueError("No audio generated (all segments skipped or empty)")

        temp_wav_path = self.export_dir / f"{output_filename}.wav"
        combined.export(str(temp_wav_path), format="wav")

        duration_seconds = len(combined) / 1000.0

        logger.info(f"Export complete: {duration_seconds:.2f}s, {len(combined)}ms, {temp_wav_path}")

        return temp_wav_path, duration_seconds

    def convert_to_format(
        self,
        input_path: Path,
        output_format: str,
        bitrate: Optional[str] = None,
        sample_rate: int = 24000,
        metadata: Optional[Dict[str, str]] = None
    ) -> Tuple[Path, int]:
        """
        Convert audio file to specified format using ffmpeg

        Args:
            input_path: Path to input audio file
            output_format: Target format (mp3, m4a, wav)
            bitrate: Bitrate for compressed formats (e.g., '192k')
            sample_rate: Sample rate in Hz
            metadata: Optional metadata dict (title, artist, album, track)

        Returns:
            Tuple of (output_path, file_size_bytes)
        """
        output_path = input_path.with_suffix(f'.{output_format.lower()}')

        if output_format.lower() == 'wav' and input_path.suffix.lower() == '.wav':
            try:
                probe = AudioSegment.from_file(str(input_path))
                current_sample_rate = probe.frame_rate

                if current_sample_rate == sample_rate:
                    file_size = input_path.stat().st_size
                    return input_path, file_size
            except Exception as e:
                logger.warning(f"Could not probe input file sample rate: {e}")

        logger.info(f"Converting to {output_format} with bitrate={bitrate}, sample_rate={sample_rate}")

        try:
            use_temp = input_path == output_path
            if use_temp:
                temp_output_path = output_path.with_suffix('.tmp' + output_path.suffix)
            else:
                temp_output_path = output_path

            cmd = ['ffmpeg', '-i', str(input_path)]

            cmd.extend(['-y'])

            cmd.extend(['-ar', str(sample_rate)])
            cmd.extend(['-ac', '1'])

            if output_format.lower() == 'mp3':
                cmd.extend(['-codec:a', 'libmp3lame'])
                if bitrate:
                    cmd.extend(['-b:a', bitrate])
                else:
                    cmd.extend(['-b:a', '192k'])

            elif output_format.lower() in ['m4a', 'aac']:
                cmd.extend(['-codec:a', 'aac'])
                if bitrate:
                    cmd.extend(['-b:a', bitrate])
                else:
                    cmd.extend(['-b:a', '192k'])

            elif output_format.lower() == 'wav':
                cmd.extend(['-codec:a', 'pcm_s16le'])

            if metadata and output_format.lower() in ['mp3', 'm4a', 'aac']:
                for key, value in metadata.items():
                    if value:
                        cmd.extend(['-metadata', f'{key}={value}'])

            cmd.append(str(temp_output_path))

            logger.debug(f"Running ffmpeg command: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                raise RuntimeError(f"FFmpeg conversion failed: {result.stderr}")

            if use_temp:
                input_path.unlink()
                temp_output_path.rename(output_path)

            file_size = output_path.stat().st_size

            if not use_temp and input_path != output_path and input_path.suffix == '.wav' and input_path.exists():
                input_path.unlink()

            return output_path, file_size

        except subprocess.CalledProcessError as e:
            error_msg = e.stderr if hasattr(e, 'stderr') else str(e)
            logger.error(f"FFmpeg conversion failed: {error_msg}")
            raise RuntimeError(f"Audio conversion failed: {error_msg}")
        except Exception as e:
            logger.error(f"Unexpected error during conversion: {e}")
            raise RuntimeError(f"Audio conversion failed: {str(e)}")

    def add_silence(self, audio_path: Path, silence_ms: int, position: str = 'end') -> Path:
        """
        Add silence to audio file

        Args:
            audio_path: Path to audio file
            silence_ms: Duration of silence in milliseconds
            position: Where to add silence ('start', 'end', or 'both')

        Returns:
            Path to modified audio file
        """
        audio = AudioSegment.from_file(str(audio_path))
        silence = AudioSegment.silent(duration=silence_ms)

        if position == 'start':
            audio = silence + audio
        elif position == 'end':
            audio = audio + silence
        elif position == 'both':
            audio = silence + audio + silence
        else:
            raise ValueError(f"Invalid position: {position}")

        audio.export(str(audio_path), format=audio_path.suffix[1:])
        return audio_path

    def get_audio_duration(self, audio_path: Path) -> float:
        """Get duration of audio file in seconds"""
        audio = AudioSegment.from_file(str(audio_path))
        return len(audio) / 1000.0

    def get_file_size(self, file_path: Path) -> int:
        """Get file size in bytes"""
        return file_path.stat().st_size

    def estimate_file_size(
        self,
        duration_seconds: float,
        format: str,
        bitrate: Optional[str] = None,
        sample_rate: int = 24000
    ) -> int:
        """
        Estimate output file size based on duration and format

        Args:
            duration_seconds: Audio duration in seconds
            format: Output format (mp3, m4a, wav)
            bitrate: Bitrate for compressed formats
            sample_rate: Sample rate in Hz

        Returns:
            Estimated file size in bytes
        """
        if format.lower() == 'wav':
            bytes_per_second = sample_rate * 2 * 2
            return int(duration_seconds * bytes_per_second)
        else:
            if not bitrate:
                bitrate = '192k'

            if bitrate.endswith('k'):
                bitrate_bps = int(bitrate[:-1]) * 1000
            else:
                bitrate_bps = int(bitrate)

            bytes_total = (bitrate_bps * duration_seconds) / 8
            return int(bytes_total * 1.1)

    def validate_audio_file(self, file_path: Path) -> bool:
        """Validate that file exists and is readable as audio"""
        if not file_path.exists():
            return False

        try:
            audio = AudioSegment.from_file(str(file_path))
            return len(audio) > 0
        except Exception:
            return False

    def cleanup_temp_files(self, job_id: str):
        """Clean up temporary files for an export job"""
        for file in self.export_dir.glob(f"*{job_id}*.wav"):
            try:
                file.unlink()
            except Exception as e:
                logger.warning(f"Failed to delete temp file {file}: {e}")