"""
Silero-VAD Audio Analysis Engine Server

Provides audio quality analysis using Silero Voice Activity Detection:
- Speech ratio (percentage of audio containing speech vs silence)
- Max silence duration (longest continuous silence segment)
- Clipping detection (audio peaks exceeding threshold)
- Volume analysis (average dB level)

This engine does not perform TTS generation - it only analyzes existing audio files.
"""

import sys
import argparse
import io
import warnings
from pathlib import Path
from typing import List
from scipy.io.wavfile import WavFileWarning

# Suppress scipy WAV chunk warnings (harmless metadata chunks)
warnings.filterwarnings("ignore", category=WavFileWarning)

# Add parent directory to path for base_server imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from typing import Optional  # noqa: E402
from base_quality_server import (  # noqa: E402
    BaseQualityServer,
    QualityThresholds,
    QualityField,
    QualityInfoBlockItem,
    AnalyzeResult,
    PronunciationRuleData
)
from base_server import ModelInfo  # noqa: E402
from loguru import logger  # noqa: E402

# Lazy imports (loaded in methods to speed up startup)
import numpy as np  # noqa: E402

# Silero-VAD package version (for display)
try:
    import silero_vad
    SILERO_VAD_VERSION = silero_vad.__version__
except (ImportError, AttributeError):
    SILERO_VAD_VERSION = "unknown"


# ============= Silero-VAD Engine Server =============

class SileroVADEngineServer(BaseQualityServer):
    """
    Silero-VAD based audio analysis engine

    Inherits from BaseQualityServer for consistent quality analysis lifecycle.
    Implements analyze_audio() for VAD-based audio quality metrics.
    """

    def __init__(self):
        super().__init__(
            engine_name="silero-vad",
            display_name="Silero VAD Audio Analysis",
            engine_type="audio"
        )

        # Silero VAD model (lazy loaded)
        self.vad_model = None

        logger.debug(f"[silero-vad] Audio analysis engine initialized (package v{SILERO_VAD_VERSION})")

    def _load_vad_model(self):
        """Load Silero VAD model from pip package"""
        if self.vad_model is None:
            try:
                logger.debug(f"[silero-vad] Loading Silero VAD model v{SILERO_VAD_VERSION}...")
                from silero_vad import load_silero_vad

                # Load model from pip package (no torch.hub download needed)
                # Model runs on CPU - lightweight enough for fast inference
                self.vad_model = load_silero_vad(onnx=False)

                logger.debug(f"[silero-vad] Silero VAD v{SILERO_VAD_VERSION} loaded successfully")
            except Exception as e:
                logger.warning(f"[silero-vad] Failed to load Silero VAD model: {e}")
                self.vad_model = None
                raise

    def analyze_audio(
        self,
        audio_bytes: bytes,
        language: str,
        thresholds: QualityThresholds,
        expected_text: Optional[str] = None,
        pronunciation_rules: Optional[List[PronunciationRuleData]] = None
    ) -> AnalyzeResult:
        """
        Analyze audio using Silero VAD and return quality metrics

        Args:
            audio_bytes: Raw audio file bytes (WAV format)
            language: Language code (not used for VAD analysis)
            thresholds: Quality thresholds for determining warnings/errors
            expected_text: Not used for audio analysis (STT only)
            pronunciation_rules: Not used for audio analysis (STT only)

        Returns:
            AnalyzeResult with speech ratio, silence, clipping, and volume metrics
        """
        # Load VAD model if needed
        self._load_vad_model()

        # Lazy imports
        import torch
        import scipy.io.wavfile

        # Read WAV from bytes
        rate, audio_data = scipy.io.wavfile.read(io.BytesIO(audio_bytes))

        # Convert to float32 and normalize to [-1, 1]
        if audio_data.dtype == np.int16:
            audio_float = audio_data.astype(np.float32) / 32768.0
        elif audio_data.dtype == np.int32:
            audio_float = audio_data.astype(np.float32) / 2147483648.0
        else:
            audio_float = audio_data.astype(np.float32)

        # Resample to 16kHz if needed (Silero VAD expects 16kHz)
        if rate != 16000:
            from scipy import signal
            num_samples = int(len(audio_float) * 16000 / rate)
            audio_float = signal.resample(audio_float, num_samples)
            rate = 16000

        # Convert to torch tensor (keep on CPU for get_speech_timestamps)
        audio_tensor = torch.from_numpy(audio_float)

        # Run VAD to get speech timestamps
        # get_speech_timestamps handles chunking internally and returns list of dicts:
        # [{'start': 0, 'end': 16000}, ...]
        from silero_vad import get_speech_timestamps

        speech_timestamps = get_speech_timestamps(
            audio_tensor,
            self.vad_model,
            sampling_rate=rate,
            return_seconds=False  # Return sample indices
        )

        # Calculate total duration
        total_samples = len(audio_float)
        total_duration_ms = (total_samples / rate) * 1000

        # Calculate speech/silence durations
        speech_samples = 0
        for segment in speech_timestamps:
            speech_samples += segment['end'] - segment['start']

        speech_duration_ms = (speech_samples / rate) * 1000

        # Calculate speech ratio (0-100)
        speech_ratio = (speech_duration_ms / total_duration_ms * 100) if total_duration_ms > 0 else 0.0

        # Find maximum silence duration
        max_silence_duration_ms = 0
        if len(speech_timestamps) > 0:
            # Check silence before first speech
            if speech_timestamps[0]['start'] > 0:
                silence_ms = (speech_timestamps[0]['start'] / rate) * 1000
                max_silence_duration_ms = max(max_silence_duration_ms, silence_ms)

            # Check silence between speech segments
            for i in range(len(speech_timestamps) - 1):
                silence_samples = speech_timestamps[i + 1]['start'] - speech_timestamps[i]['end']
                silence_ms = (silence_samples / rate) * 1000
                max_silence_duration_ms = max(max_silence_duration_ms, silence_ms)

            # Check silence after last speech
            if speech_timestamps[-1]['end'] < total_samples:
                silence_ms = ((total_samples - speech_timestamps[-1]['end']) / rate) * 1000
                max_silence_duration_ms = max(max_silence_duration_ms, silence_ms)
        else:
            # No speech detected - entire audio is silence
            max_silence_duration_ms = total_duration_ms

        # Detect clipping
        peak_amplitude = float(np.max(np.abs(audio_float)))
        # Convert to dB (relative to full scale)
        if peak_amplitude > 0:
            peak_db = 20 * np.log10(peak_amplitude)
        else:
            peak_db = -np.inf
        has_clipping = peak_db > thresholds.max_clipping_peak

        # Calculate average volume (RMS in dB)
        rms = np.sqrt(np.mean(audio_float ** 2))
        if rms > 0:
            avg_volume_db = 20 * np.log10(rms)
        else:
            avg_volume_db = -np.inf
        low_volume = avg_volume_db < thresholds.min_average_volume

        # Determine quality score and status
        issues = []
        info_blocks = {}

        # Check speech ratio
        # Text keys are suffixes - Frontend prepends "quality.issues."
        if speech_ratio < thresholds.speech_ratio_warning_min or speech_ratio > thresholds.speech_ratio_warning_max:
            # Critical: outside warning range
            if speech_ratio < thresholds.speech_ratio_ideal_min:
                issues.append(QualityInfoBlockItem(
                    text="speechRatioTooLow",
                    severity="error",
                    details={"speechRatio": round(speech_ratio, 1), "threshold": thresholds.speech_ratio_warning_min}
                ))
            else:
                issues.append(QualityInfoBlockItem(
                    text="speechRatioTooHigh",
                    severity="error",
                    details={"speechRatio": round(speech_ratio, 1), "threshold": thresholds.speech_ratio_warning_max}
                ))
        elif speech_ratio < thresholds.speech_ratio_ideal_min or speech_ratio > thresholds.speech_ratio_ideal_max:
            # Warning: outside ideal range but within warning range
            if speech_ratio < thresholds.speech_ratio_ideal_min:
                issues.append(QualityInfoBlockItem(
                    text="speechRatioBelowIdeal",
                    severity="warning",
                    details={"speechRatio": round(speech_ratio, 1), "threshold": thresholds.speech_ratio_ideal_min}
                ))
            else:
                issues.append(QualityInfoBlockItem(
                    text="speechRatioAboveIdeal",
                    severity="warning",
                    details={"speechRatio": round(speech_ratio, 1), "threshold": thresholds.speech_ratio_ideal_max}
                ))

        # Check silence duration
        if max_silence_duration_ms >= thresholds.max_silence_duration_critical:
            issues.append(QualityInfoBlockItem(
                text="silenceTooLong",
                severity="error",
                details={"silenceDurationMs": int(max_silence_duration_ms), "threshold": thresholds.max_silence_duration_critical}
            ))
        elif max_silence_duration_ms >= thresholds.max_silence_duration_warning:
            issues.append(QualityInfoBlockItem(
                text="silenceDetected",
                severity="warning",
                details={"silenceDurationMs": int(max_silence_duration_ms), "threshold": thresholds.max_silence_duration_warning}
            ))

        # Check clipping
        if has_clipping:
            issues.append(QualityInfoBlockItem(
                text="clippingDetected",
                severity="error",
                details={"peakDb": round(peak_db, 1), "threshold": thresholds.max_clipping_peak}
            ))

        # Check volume
        if low_volume:
            issues.append(QualityInfoBlockItem(
                text="volumeTooLow",
                severity="warning",
                details={"avgVolumeDb": round(avg_volume_db, 1), "threshold": thresholds.min_average_volume}
            ))

        # Add issues to info_blocks
        if issues:
            info_blocks["audioIssues"] = issues

        # Calculate quality score (0-100)
        # Base score starts at 100, subtract points for each issue
        quality_score = 100

        # Speech ratio scoring:
        # - Within ideal range: no penalty
        # - Outside ideal but within warning range: up to 15 points penalty (warning)
        # - Outside warning range: 31+ points penalty (forces defect status)
        speech_ratio_penalty = 0

        if speech_ratio < thresholds.speech_ratio_warning_min:
            # Critical: below warning threshold -> defect (31+ points to ensure score < 70)
            # Calculate how far below warning_min (0 at warning_min, 1 at 0%)
            if thresholds.speech_ratio_warning_min > 0:
                severity = (thresholds.speech_ratio_warning_min - speech_ratio) / thresholds.speech_ratio_warning_min
            else:
                severity = 1.0
            speech_ratio_penalty = 31 + int(severity * 19)  # 31-50 points
        elif speech_ratio > thresholds.speech_ratio_warning_max:
            # Critical: above warning threshold -> defect (31+ points to ensure score < 70)
            # Calculate how far above warning_max (0 at warning_max, 1 at 100%)
            remaining = 100 - thresholds.speech_ratio_warning_max
            if remaining > 0:
                severity = (speech_ratio - thresholds.speech_ratio_warning_max) / remaining
            else:
                severity = 1.0
            speech_ratio_penalty = 31 + int(severity * 19)  # 31-50 points
        elif speech_ratio < thresholds.speech_ratio_ideal_min:
            # Warning: below ideal but within warning range (max 15 points)
            range_size = thresholds.speech_ratio_ideal_min - thresholds.speech_ratio_warning_min
            if range_size > 0:
                deviation = (thresholds.speech_ratio_ideal_min - speech_ratio) / range_size
            else:
                deviation = 0
            speech_ratio_penalty = int(deviation * 15)
        elif speech_ratio > thresholds.speech_ratio_ideal_max:
            # Warning: above ideal but within warning range (max 15 points)
            range_size = thresholds.speech_ratio_warning_max - thresholds.speech_ratio_ideal_max
            if range_size > 0:
                deviation = (speech_ratio - thresholds.speech_ratio_ideal_max) / range_size
            else:
                deviation = 0
            speech_ratio_penalty = int(deviation * 15)

        quality_score -= speech_ratio_penalty

        # Silence duration scoring:
        # - Below warning threshold: no penalty
        # - Between warning and critical: up to 15 points penalty (warning)
        # - Above critical: 31+ points penalty (forces defect status)
        silence_penalty = 0
        if max_silence_duration_ms >= thresholds.max_silence_duration_critical:
            # Critical: above critical threshold -> defect (31+ points)
            excess = max_silence_duration_ms - thresholds.max_silence_duration_critical
            severity = min(1.0, excess / thresholds.max_silence_duration_critical) if thresholds.max_silence_duration_critical > 0 else 1.0
            silence_penalty = 31 + int(severity * 19)  # 31-50 points
        elif max_silence_duration_ms >= thresholds.max_silence_duration_warning:
            # Warning: between warning and critical (max 15 points)
            range_size = thresholds.max_silence_duration_critical - thresholds.max_silence_duration_warning
            if range_size > 0:
                deviation = (max_silence_duration_ms - thresholds.max_silence_duration_warning) / range_size
            else:
                deviation = 0
            silence_penalty = int(deviation * 15)

        quality_score -= silence_penalty

        # Clipping: instant defect (31 points to ensure score < 70)
        if has_clipping:
            quality_score -= 31

        # Low volume (max -10 points)
        if low_volume:
            volume_penalty = min(10, abs(avg_volume_db - thresholds.min_average_volume) / 2)
            quality_score -= int(volume_penalty)

        # Ensure score is in valid range
        quality_score = max(0, min(100, quality_score))

        # Build fields for UI
        # Keys are suffixes - Frontend prepends "quality.fields."
        fields = [
            QualityField(key="speechRatio", value=int(speech_ratio), type="percent"),
            QualityField(key="maxSilence", value=int(max_silence_duration_ms), type="number"),
            QualityField(key="peakVolume", value=f"{peak_db:.1f} dB", type="string"),
            QualityField(key="avgVolume", value=f"{avg_volume_db:.1f} dB", type="string"),
        ]

        logger.info(
            f"[silero-vad] Analysis complete | "
            f"Speech: {speech_ratio:.1f}% | "
            f"Max Silence: {max_silence_duration_ms:.0f}ms | "
            f"Peak: {peak_db:.1f}dB | "
            f"Avg Vol: {avg_volume_db:.1f}dB | "
            f"Score: {quality_score}/100"
        )

        return AnalyzeResult(
            quality_score=quality_score,
            fields=fields,
            info_blocks=info_blocks,
            top_label="audioQuality"  # Frontend: quality.topLabels.audioQuality
        )

    # ============= Base Class Overrides =============

    def get_available_models(self) -> List[ModelInfo]:
        """
        Return Silero VAD model info.

        Silero-VAD has a single model from the pip package.
        Version is read from silero_vad.__version__.
        """
        self.default_model = "silero-vad"
        return [
            ModelInfo(
                name="silero-vad",
                display_name=f"Silero VAD v{SILERO_VAD_VERSION}",
                languages=[]  # Voice activity detection is language-independent
            )
        ]

    def load_model(self, model_name: str) -> None:
        """
        Load Silero-VAD model from pip package.

        This properly loads the model and sets model_loaded=True.
        """
        logger.debug(f"[silero-vad] load_model called: {model_name}")
        if model_name in ["silero-vad", "default"]:
            self._load_vad_model()
            self.model_loaded = True
            self.current_model = "silero-vad"
        else:
            raise ValueError(f"Unknown model: {model_name}. Silero-VAD only supports 'silero-vad'.")

    def unload_model(self) -> None:
        """
        Unload VAD model to free memory
        """
        if self.vad_model is not None:
            logger.info("[silero-vad] Unloading VAD model")
            self.vad_model = None

            # Force garbage collection
            import gc
            gc.collect()

        self.model_loaded = False
        self.current_model = None

    def get_package_version(self) -> str:
        """Return silero-vad package version for health endpoint"""
        return SILERO_VAD_VERSION


# ============= Main Entry Point =============

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Silero-VAD Audio Analysis Engine Server")
    parser.add_argument("--port", type=int, required=True, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")

    args = parser.parse_args()

    # Create and run server
    server = SileroVADEngineServer()
    server.run(port=args.port, host=args.host)
