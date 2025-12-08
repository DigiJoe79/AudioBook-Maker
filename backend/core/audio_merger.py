"""Audio file merging for multi-chunk TTS generation."""
import os
import wave
import struct
from typing import List, Optional
from pathlib import Path
from loguru import logger

class AudioMerger:
    """Merges multiple audio files into a single file."""

    def __init__(self, temp_dir: Optional[str] = None):
        """Initialize audio merger.

        Args:
            temp_dir: Directory for temporary files.
                     If None, uses CONTENT_DIR/temp from config.py.
        """
        if temp_dir is None:
            # Import here to avoid circular imports
            from config import CONTENT_DIR
            self.temp_dir = (Path(CONTENT_DIR) / "temp").resolve()
        else:
            self.temp_dir = Path(temp_dir).resolve()

        self.temp_dir.mkdir(parents=True, exist_ok=True)

    def merge_wav_files(
        self,
        audio_files: List[str],
        output_filename: str,
        silence_ms: int = 0,
        cleanup: bool = False
    ) -> str:
        """Merge multiple WAV files into one.

        Args:
            audio_files: List of WAV file paths to merge
            output_filename: Name for output file
            silence_ms: Milliseconds of silence to add between files
            cleanup: Whether to delete source files after merging

        Returns:
            Path to merged audio file
        """
        if not audio_files:
            raise ValueError("No audio files provided")

        output_path = self.temp_dir / output_filename

        # If only one file, just copy it
        if len(audio_files) == 1:
            import shutil
            shutil.copy2(audio_files[0], output_path)

            if cleanup:
                os.remove(audio_files[0])

            return str(output_path)

        # Read first file to get audio parameters
        with wave.open(audio_files[0], 'rb') as first_wav:
            params = first_wav.getparams()
            channels = params.nchannels
            sampwidth = params.sampwidth
            framerate = params.framerate

        # Calculate silence frames
        silence_frames = int((silence_ms / 1000.0) * framerate)
        silence_data = struct.pack('<' + 'h' * silence_frames * channels,
                                   *([0] * silence_frames * channels))

        # Open output file
        with wave.open(str(output_path), 'wb') as output_wav:
            output_wav.setnchannels(channels)
            output_wav.setsampwidth(sampwidth)
            output_wav.setframerate(framerate)

            # Process each input file
            for i, audio_file in enumerate(audio_files):
                try:
                    with wave.open(audio_file, 'rb') as input_wav:
                        # Verify parameters match
                        if (input_wav.getnchannels() != channels or
                            input_wav.getsampwidth() != sampwidth or
                            input_wav.getframerate() != framerate):
                            logger.warning(
                                f"[AudioMerger] Audio parameters mismatch path={audio_file}, "
                                f"attempting to continue"
                            )

                        # Copy audio data
                        frames = input_wav.readframes(input_wav.getnframes())
                        output_wav.writeframes(frames)

                        # Add silence between files (not after last)
                        if silence_ms > 0 and i < len(audio_files) - 1:
                            output_wav.writeframes(silence_data)

                        logger.debug(f"[AudioMerger] Merged audio file [{i+1}/{len(audio_files)}] path={audio_file}")

                except Exception as e:
                    logger.error(f"[AudioMerger] Failed to process audio file path={audio_file} error={e}")
                    raise

        # Cleanup source files if requested
        if cleanup:
            for audio_file in audio_files:
                try:
                    os.remove(audio_file)
                    logger.debug(f"[AudioMerger] Cleaned up temporary file path={audio_file}")
                except Exception as e:
                    logger.warning(f"[AudioMerger] Failed to delete temporary file path={audio_file} error={e}")

        logger.info(f"[AudioMerger] Successfully merged audio files count={len(audio_files)} output_path={output_path}")
        return str(output_path)

    def merge_audio_bytes(
        self,
        audio_chunks: List[bytes],
        output_filename: str,
        sample_rate: int = 24000,
        silence_ms: int = 0
    ) -> str:
        """Merge audio bytes directly without intermediate files.

        Args:
            audio_chunks: List of WAV audio data as bytes
            output_filename: Name for output file
            sample_rate: Sample rate (default 24000 for XTTS)
            silence_ms: Milliseconds of silence between chunks

        Returns:
            Path to merged audio file
        """
        if not audio_chunks:
            raise ValueError("No audio chunks provided")

        output_path = self.temp_dir / output_filename

        # Parse first chunk to get parameters
        import io
        with wave.open(io.BytesIO(audio_chunks[0]), 'rb') as first_wav:
            params = first_wav.getparams()
            channels = params.nchannels
            sampwidth = params.sampwidth
            framerate = params.framerate

        # Calculate silence
        silence_frames = int((silence_ms / 1000.0) * framerate)
        silence_data = struct.pack('<' + 'h' * silence_frames * channels,
                                   *([0] * silence_frames * channels))

        # Merge all chunks
        with wave.open(str(output_path), 'wb') as output_wav:
            output_wav.setnchannels(channels)
            output_wav.setsampwidth(sampwidth)
            output_wav.setframerate(framerate)

            for i, audio_bytes in enumerate(audio_chunks):
                with wave.open(io.BytesIO(audio_bytes), 'rb') as chunk_wav:
                    frames = chunk_wav.readframes(chunk_wav.getnframes())
                    output_wav.writeframes(frames)

                    # Add silence between chunks
                    if silence_ms > 0 and i < len(audio_chunks) - 1:
                        output_wav.writeframes(silence_data)

        logger.info(f"[AudioMerger] Merged audio chunks count={len(audio_chunks)} output_path={output_path}")
        return str(output_path)
