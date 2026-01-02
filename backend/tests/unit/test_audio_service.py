"""
Unit Tests for AudioService

Tests the audio processing service for merging segments and format conversion.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, MagicMock, patch
import tempfile

from services.audio_service import AudioService


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def temp_dirs():
    """Create temporary directories for testing."""
    with tempfile.TemporaryDirectory() as output_dir:
        with tempfile.TemporaryDirectory() as export_dir:
            yield output_dir, export_dir


@pytest.fixture
def audio_service(temp_dirs):
    """Create AudioService with temporary directories."""
    output_dir, export_dir = temp_dirs

    with patch('services.audio_service.OUTPUT_DIR', output_dir):
        with patch('services.audio_service.EXPORTS_DIR', export_dir):
            service = AudioService(output_dir=output_dir)
            service.export_dir = Path(export_dir)
            yield service


@pytest.fixture
def mock_audio_segment():
    """Mock pydub.AudioSegment."""
    with patch('services.audio_service.AudioSegment') as mock:
        # Create a mock for the empty() class method
        mock_combined = MagicMock()
        mock_combined.__len__ = Mock(return_value=10000)  # 10 seconds
        mock_combined.__iadd__ = Mock(return_value=mock_combined)
        mock_combined.__add__ = Mock(return_value=mock_combined)
        mock.empty.return_value = mock_combined

        # Mock silent() for pause generation
        mock_silence = MagicMock()
        mock.silent.return_value = mock_silence

        # Mock from_file() for loading audio
        mock_audio = MagicMock()
        mock_audio.frame_rate = 24000
        mock.from_file.return_value = mock_audio

        yield mock, mock_combined


# ============================================================================
# Test: url_to_local_path
# ============================================================================

class TestUrlToLocalPath:
    """Tests for url_to_local_path method."""

    def test_converts_audio_url_to_local_path(self, audio_service, temp_dirs):
        """Audio URL is converted to output directory path."""
        output_dir, _ = temp_dirs

        # Create test file
        test_file = Path(output_dir) / "segment_123.wav"
        test_file.write_bytes(b"fake audio")

        url = "http://localhost:8765/audio/segment_123.wav"
        result = audio_service.url_to_local_path(url)

        assert result == test_file

    def test_converts_exports_url_to_local_path(self, audio_service, temp_dirs):
        """Exports URL is converted to export directory path."""
        _, export_dir = temp_dirs
        audio_service.export_dir = Path(export_dir)

        # Create test file
        test_file = Path(export_dir) / "chapter.mp3"
        test_file.write_bytes(b"fake audio")

        url = "http://localhost:8765/exports/chapter.mp3"
        result = audio_service.url_to_local_path(url)

        assert result == test_file

    def test_raises_for_nonexistent_file(self, audio_service):
        """FileNotFoundError raised for missing file."""
        url = "http://localhost:8765/audio/nonexistent.wav"

        with pytest.raises(FileNotFoundError):
            audio_service.url_to_local_path(url)

    def test_fallback_to_filename_only(self, audio_service, temp_dirs):
        """Unknown URL path falls back to filename in output dir."""
        output_dir, _ = temp_dirs

        # Create test file
        test_file = Path(output_dir) / "unknown.wav"
        test_file.write_bytes(b"fake audio")

        url = "http://localhost:8765/unknown/path/unknown.wav"
        result = audio_service.url_to_local_path(url)

        assert result == test_file


# ============================================================================
# Test: merge_segments_to_file
# ============================================================================

class TestMergeSegmentsToFile:
    """Tests for merge_segments_to_file method."""

    def test_merges_standard_segments_with_pauses(self, audio_service, temp_dirs, mock_audio_segment):
        """Standard segments are merged with pauses between them."""
        output_dir, export_dir = temp_dirs
        mock_class, mock_combined = mock_audio_segment

        # Create test audio files
        audio_file = Path(output_dir) / "segment_1.wav"
        audio_file.write_bytes(b"fake audio")

        segments = [
            {
                'id': '1',
                'segment_type': 'standard',
                'audio_path': "http://localhost:8765/audio/segment_1.wav",
                'status': 'completed'
            },
            {
                'id': '2',
                'segment_type': 'standard',
                'audio_path': "http://localhost:8765/audio/segment_1.wav",
                'status': 'completed'
            }
        ]

        output_path, duration = audio_service.merge_segments_to_file(
            segments,
            "test_output",
            pause_ms=500
        )

        # Verify AudioSegment methods were called
        assert mock_class.from_file.call_count == 2
        assert mock_class.silent.call_count >= 1  # At least one pause

    def test_handles_divider_segments(self, audio_service, temp_dirs, mock_audio_segment):
        """Divider segments add pause without audio."""
        output_dir, export_dir = temp_dirs
        mock_class, mock_combined = mock_audio_segment

        # Create test audio file
        audio_file = Path(output_dir) / "segment_1.wav"
        audio_file.write_bytes(b"fake audio")

        segments = [
            {
                'id': '1',
                'segment_type': 'standard',
                'audio_path': "http://localhost:8765/audio/segment_1.wav",
                'status': 'completed'
            },
            {
                'id': 'div1',
                'segment_type': 'divider',
                'pause_duration': 2000
            }
        ]

        output_path, duration = audio_service.merge_segments_to_file(
            segments,
            "test_output"
        )

        # Divider should create 2000ms silence
        mock_class.silent.assert_any_call(duration=2000)

    def test_raises_for_empty_segments(self, audio_service):
        """ValueError raised for empty segment list."""
        with pytest.raises(ValueError, match="No segments to merge"):
            audio_service.merge_segments_to_file([], "output")

    def test_skips_incomplete_segments(self, audio_service, temp_dirs, mock_audio_segment):
        """Segments without 'completed' status are skipped."""
        output_dir, _ = temp_dirs
        mock_class, mock_combined = mock_audio_segment

        # Make combined empty to trigger error
        mock_combined.__len__ = Mock(return_value=0)

        segments = [
            {
                'id': '1',
                'segment_type': 'standard',
                'audio_path': 'http://localhost:8765/audio/test.wav',
                'status': 'pending'  # Not completed
            }
        ]

        with pytest.raises(ValueError, match="No audio generated"):
            audio_service.merge_segments_to_file(segments, "output")

    def test_skips_segments_without_audio_path(self, audio_service, temp_dirs, mock_audio_segment):
        """Standard segments without audio_path are skipped."""
        mock_class, mock_combined = mock_audio_segment
        mock_combined.__len__ = Mock(return_value=0)

        segments = [
            {
                'id': '1',
                'segment_type': 'standard',
                'status': 'completed'
                # No audio_path
            }
        ]

        with pytest.raises(ValueError, match="No audio generated"):
            audio_service.merge_segments_to_file(segments, "output")

    def test_calls_progress_callback(self, audio_service, temp_dirs, mock_audio_segment):
        """Progress callback is called for each segment."""
        output_dir, _ = temp_dirs
        mock_class, _ = mock_audio_segment

        # Create test audio file
        audio_file = Path(output_dir) / "test.wav"
        audio_file.write_bytes(b"fake audio")

        segments = [
            {
                'id': '1',
                'segment_type': 'standard',
                'audio_path': 'http://localhost:8765/audio/test.wav',
                'status': 'completed'
            },
            {
                'id': '2',
                'segment_type': 'standard',
                'audio_path': 'http://localhost:8765/audio/test.wav',
                'status': 'completed'
            }
        ]

        progress_callback = Mock()

        audio_service.merge_segments_to_file(
            segments,
            "output",
            progress_callback=progress_callback
        )

        # Should be called twice (once per segment)
        assert progress_callback.call_count == 2
        progress_callback.assert_any_call(1, 2)
        progress_callback.assert_any_call(2, 2)

    def test_respects_cancellation_callback(self, audio_service, temp_dirs, mock_audio_segment):
        """InterruptedError raised when cancellation callback signals cancel."""
        output_dir, _ = temp_dirs

        segments = [
            {
                'id': '1',
                'segment_type': 'standard',
                'audio_path': 'http://localhost:8765/audio/test.wav',
                'status': 'completed'
            }
        ]

        def cancel_callback():
            raise InterruptedError("Cancelled")

        with pytest.raises(InterruptedError):
            audio_service.merge_segments_to_file(
                segments,
                "output",
                cancellation_callback=cancel_callback
            )

    def test_no_pause_after_last_segment(self, audio_service, temp_dirs, mock_audio_segment):
        """No pause is added after the last segment."""
        output_dir, _ = temp_dirs
        mock_class, mock_combined = mock_audio_segment

        # Create test audio file
        audio_file = Path(output_dir) / "test.wav"
        audio_file.write_bytes(b"fake audio")

        segments = [
            {
                'id': '1',
                'segment_type': 'standard',
                'audio_path': 'http://localhost:8765/audio/test.wav',
                'status': 'completed'
            }
        ]

        audio_service.merge_segments_to_file(segments, "output", pause_ms=500)

        # No silence calls for single segment (no pause after last)
        mock_class.silent.assert_not_called()


# ============================================================================
# Test: convert_to_format
# ============================================================================

class TestConvertToFormat:
    """Tests for convert_to_format method."""

    def test_converts_to_mp3(self, audio_service, temp_dirs):
        """WAV to MP3 conversion uses correct ffmpeg settings."""
        _, export_dir = temp_dirs

        # Create test WAV file
        input_path = Path(export_dir) / "test.wav"
        input_path.write_bytes(b"RIFF" + b"\x00" * 100)  # Minimal WAV header

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(returncode=0)

            # Create expected output file
            output_path = Path(export_dir) / "test.mp3"
            output_path.write_bytes(b"ID3" + b"\x00" * 100)  # Minimal MP3 header

            result_path, size = audio_service.convert_to_format(
                input_path,
                'mp3',
                bitrate='192k'
            )

            # Verify ffmpeg was called with correct codec
            mock_run.assert_called_once()
            cmd = mock_run.call_args[0][0]
            assert '-codec:a' in cmd
            assert 'libmp3lame' in cmd
            assert '-b:a' in cmd
            assert '192k' in cmd

    def test_converts_to_m4a(self, audio_service, temp_dirs):
        """WAV to M4A conversion uses AAC codec."""
        _, export_dir = temp_dirs

        input_path = Path(export_dir) / "test.wav"
        input_path.write_bytes(b"RIFF" + b"\x00" * 100)

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(returncode=0)

            output_path = Path(export_dir) / "test.m4a"
            output_path.write_bytes(b"\x00" * 100)

            result_path, size = audio_service.convert_to_format(
                input_path,
                'm4a',
                bitrate='128k'
            )

            cmd = mock_run.call_args[0][0]
            assert '-codec:a' in cmd
            assert 'aac' in cmd

    def test_wav_no_conversion_if_same_sample_rate(self, audio_service, temp_dirs, mock_audio_segment):
        """WAV to WAV with same sample rate skips conversion."""
        _, export_dir = temp_dirs
        mock_class, _ = mock_audio_segment

        input_path = Path(export_dir) / "test.wav"
        input_path.write_bytes(b"RIFF" + b"\x00" * 100)

        # Mock probe returns matching sample rate
        mock_probe = MagicMock()
        mock_probe.frame_rate = 24000
        mock_class.from_file.return_value = mock_probe

        with patch('subprocess.run') as mock_run:
            result_path, size = audio_service.convert_to_format(
                input_path,
                'wav',
                sample_rate=24000
            )

            # FFmpeg should NOT be called
            mock_run.assert_not_called()
            assert result_path == input_path

    def test_adds_metadata_to_mp3(self, audio_service, temp_dirs):
        """Metadata is added to MP3 files."""
        _, export_dir = temp_dirs

        input_path = Path(export_dir) / "test.wav"
        input_path.write_bytes(b"RIFF" + b"\x00" * 100)

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(returncode=0)

            output_path = Path(export_dir) / "test.mp3"
            output_path.write_bytes(b"ID3" + b"\x00" * 100)

            metadata = {
                'title': 'Chapter 1',
                'artist': 'Test Author',
                'album': 'Test Book'
            }

            audio_service.convert_to_format(
                input_path,
                'mp3',
                metadata=metadata
            )

            cmd = mock_run.call_args[0][0]
            assert '-metadata' in cmd
            # Check metadata values are in command
            cmd_str = ' '.join(cmd)
            assert 'title=Chapter 1' in cmd_str
            assert 'artist=Test Author' in cmd_str

    def test_raises_on_ffmpeg_failure(self, audio_service, temp_dirs):
        """RuntimeError raised when ffmpeg fails."""
        _, export_dir = temp_dirs

        input_path = Path(export_dir) / "test.wav"
        input_path.write_bytes(b"RIFF" + b"\x00" * 100)

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(returncode=1, stderr="Conversion failed")

            with pytest.raises(RuntimeError, match="FFmpeg conversion failed"):
                audio_service.convert_to_format(input_path, 'mp3')


# ============================================================================
# Test: get_audio_duration
# ============================================================================

class TestGetAudioDuration:
    """Tests for get_audio_duration method."""

    def test_returns_duration_in_seconds(self, audio_service, temp_dirs, mock_audio_segment):
        """Duration is returned in seconds."""
        _, export_dir = temp_dirs
        mock_class, _ = mock_audio_segment

        # Mock returns 5000ms (5 seconds)
        mock_audio = MagicMock()
        mock_audio.__len__ = Mock(return_value=5000)
        mock_class.from_file.return_value = mock_audio

        test_file = Path(export_dir) / "test.wav"
        test_file.write_bytes(b"RIFF" + b"\x00" * 100)

        duration = audio_service.get_audio_duration(test_file)

        assert duration == 5.0


# ============================================================================
# Test: cleanup_temp_files
# ============================================================================

class TestCleanupTempFiles:
    """Tests for cleanup_temp_files method."""

    def test_deletes_matching_wav_files(self, audio_service, temp_dirs):
        """WAV files matching job_id pattern are deleted."""
        _, export_dir = temp_dirs
        audio_service.export_dir = Path(export_dir)

        job_id = "test-job-123"

        # Create test files
        matching_file1 = Path(export_dir) / f"chapter_{job_id}.wav"
        matching_file2 = Path(export_dir) / f"{job_id}_temp.wav"
        non_matching = Path(export_dir) / "other_file.wav"

        matching_file1.write_bytes(b"test")
        matching_file2.write_bytes(b"test")
        non_matching.write_bytes(b"test")

        audio_service.cleanup_temp_files(job_id)

        # Matching files should be deleted
        assert not matching_file1.exists()
        assert not matching_file2.exists()

        # Non-matching file should remain
        assert non_matching.exists()

    def test_handles_deletion_errors_gracefully(self, audio_service, temp_dirs):
        """Deletion errors are logged but don't raise exceptions."""
        _, export_dir = temp_dirs
        audio_service.export_dir = Path(export_dir)

        job_id = "test-job-456"

        # Create a file
        test_file = Path(export_dir) / f"{job_id}.wav"
        test_file.write_bytes(b"test")

        # Make file read-only on Windows this might not work the same way
        # so we mock the unlink to raise an error
        with patch.object(Path, 'unlink', side_effect=PermissionError("Access denied")):
            # Should not raise exception
            audio_service.cleanup_temp_files(job_id)
