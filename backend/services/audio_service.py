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

        # Create exports subdirectory
        self.export_dir = Path(EXPORTS_DIR)
        self.export_dir.mkdir(exist_ok=True)

    def url_to_local_path(self, url: str) -> Path:
        """Convert HTTP URL to local file path"""
        # Extract path from URL
        # Examples:
        #   http://localhost:8765/audio/segment_123.wav -> output/segment_123.wav
        #   http://localhost:8765/exports/chapter.mp3 -> exports/chapter.mp3
        parsed = urllib.parse.urlparse(url)
        path_parts = parsed.path.strip('/').split('/')

        # Determine base directory based on URL path
        if 'exports' in path_parts:
            # Export files are in export_dir
            exports_index = path_parts.index('exports')
            filename = '/'.join(path_parts[exports_index + 1:])
            local_path = self.export_dir / filename
        elif 'audio' in path_parts:
            # Audio segment files are in output_dir
            audio_index = path_parts.index('audio')
            filename = '/'.join(path_parts[audio_index + 1:])
            local_path = self.output_dir / filename
        else:
            # Fallback: assume filename is last part
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
        progress_callback: Optional[callable] = None,
        cancellation_callback: Optional[callable] = None
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
            cancellation_callback: Optional callback to check for cancellation (throws InterruptedError if cancelled)

        Returns:
            Tuple of (output_path, total_duration_seconds)
        """
        if not segments:
            raise ValueError("No segments to merge")

        logger.info(f"[AudioService] Merging segments count={len(segments)} pause_ms={pause_ms}")

        # Start with empty audio
        combined = AudioSegment.empty()

        # Process all segments in order (standard + divider)
        for i, segment in enumerate(segments):
            try:
                # FIX BUG 2: Check for cancellation BEFORE processing segment (immediate abort)
                if cancellation_callback:
                    cancellation_callback()

                segment_type = segment.get('segment_type', 'standard')

                if segment_type == 'divider':
                    # Divider = only pause (no audio)
                    pause_duration = segment.get('pause_duration', 2000)
                    logger.debug(f"Adding divider pause: {pause_duration}ms")
                    silence = AudioSegment.silent(duration=pause_duration)
                    combined += silence

                elif segment_type == 'standard':
                    # Standard segment = audio + standard pause
                    if not segment.get('audio_path'):
                        logger.warning(f"Skipping standard segment {segment.get('id')} without audio")
                        continue

                    if segment.get('status') != 'completed':
                        logger.warning(f"Skipping incomplete segment {segment.get('id')}")
                        continue

                    # Convert URL to local path
                    local_path = self.url_to_local_path(segment['audio_path'])

                    # Load audio segment
                    audio = AudioSegment.from_file(str(local_path))
                    combined += audio

                    # Add standard pause after segment (but not after last segment)
                    # This pause is added before the next segment (standard OR divider)
                    if i < len(segments) - 1 and pause_ms > 0:
                        silence = AudioSegment.silent(duration=pause_ms)
                        combined += silence
                        logger.debug(f"Added {pause_ms}ms pause after standard segment")

                # Update progress
                if progress_callback:
                    progress_callback(i + 1, len(segments))

            except InterruptedError:
                # FIX BUG 2: Re-raise cancellation (not an error, don't log as error)
                logger.debug(f"Merge interrupted at segment {i} (cancellation requested)")
                raise

            except Exception as e:
                logger.error(f"Failed to process segment {i} (type: {segment.get('segment_type')}): {e}")
                # Continue with other segments instead of failing completely
                continue

        if len(combined) == 0:
            raise ValueError("No audio generated (all segments skipped or empty)")

        # Save as WAV initially (lossless for further processing)
        temp_wav_path = self.export_dir / f"{output_filename}.wav"
        combined.export(str(temp_wav_path), format="wav")

        # Get duration in seconds
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
        # Determine output path
        output_path = input_path.with_suffix(f'.{output_format.lower()}')

        # Check if we need to do any conversion at all
        # For WAV: check if sample rate matches and input is already WAV
        if output_format.lower() == 'wav' and input_path.suffix.lower() == '.wav':
            # Check current sample rate of input file
            try:
                probe = AudioSegment.from_file(str(input_path))
                current_sample_rate = probe.frame_rate

                # If sample rate matches, no need to convert
                if current_sample_rate == sample_rate:
                    file_size = input_path.stat().st_size
                    return input_path, file_size
            except Exception as e:
                logger.warning(f"Could not probe input file sample rate: {e}")
                # Continue with conversion if probe fails

        logger.info(f"Converting to {output_format} with bitrate={bitrate}, sample_rate={sample_rate}")

        try:
            # Check if input and output are the same file
            # If so, use a temporary file for output
            use_temp = input_path == output_path
            if use_temp:
                temp_output_path = output_path.with_suffix('.tmp' + output_path.suffix)
            else:
                temp_output_path = output_path

            # Build ffmpeg command using subprocess for better metadata handling
            cmd = ['ffmpeg', '-i', str(input_path)]

            # Add overwrite flag
            cmd.extend(['-y'])

            # Audio processing options
            cmd.extend(['-ar', str(sample_rate)])  # Sample rate
            cmd.extend(['-ac', '1'])  # Mono (since input is mono)

            # Format-specific options
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
                # No bitrate for WAV

            # Add metadata if provided (for MP3 and M4A)
            if metadata and output_format.lower() in ['mp3', 'm4a', 'aac']:
                for key, value in metadata.items():
                    if value:
                        cmd.extend(['-metadata', f'{key}={value}'])

            # Output file (use temp if needed)
            cmd.append(str(temp_output_path))

            # Run ffmpeg
            logger.debug(f"Running ffmpeg command: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                raise RuntimeError(f"FFmpeg conversion failed: {result.stderr}")

            # If we used a temp file, replace the original
            if use_temp:
                input_path.unlink()  # Delete original
                temp_output_path.rename(output_path)  # Rename temp to final name

            # Get file size
            file_size = output_path.stat().st_size

            # Clean up temporary WAV if different from output (and not already cleaned up)
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

    def get_audio_duration(self, audio_path: Path) -> float:
        """Get duration of audio file in seconds"""
        audio = AudioSegment.from_file(str(audio_path))
        return len(audio) / 1000.0

    def cleanup_temp_files(self, job_id: str):
        """Clean up temporary files for an export job"""
        # Clean up any temporary WAV files
        for file in self.export_dir.glob(f"*{job_id}*.wav"):
            try:
                file.unlink()
            except Exception as e:
                logger.warning(f"Failed to delete temp file {file}: {e}")