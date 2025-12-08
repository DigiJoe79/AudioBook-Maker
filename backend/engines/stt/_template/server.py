"""
Template STT Engine Server

Inherits from BaseQualityServer for consistent lifecycle management.
Provides STT-specific analysis endpoint:
- /analyze - Transcribe audio and return Generic Quality Format

Standard endpoints from BaseEngineServer:
- /health - Health check
- /load - Load model
- /models - List available models
- /shutdown - Graceful shutdown

TODO: Rename this file's class and customize for your engine.
"""

import sys
from pathlib import Path
from typing import List

# Add parent directory to path for base_server imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from typing import Optional
from base_quality_server import (
    BaseQualityServer,
    QualityThresholds,
    QualityField,
    QualityInfoBlockItem,
    AnalyzeResult,
    PronunciationRuleData
)
from base_server import ModelInfo
from loguru import logger


class TemplateSTTServer(BaseQualityServer):
    """
    Template STT engine server.

    TODO: Rename this class to match your engine (e.g., MySTTServer).

    STT engines transcribe audio and return quality metrics based on
    transcription confidence and accuracy.
    """

    def __init__(self):
        super().__init__(
            engine_name="template_stt",  # TODO: Change to your engine name
            display_name="Template STT",  # TODO: Change display name
            engine_type="stt"  # Always "stt" for STT engines
        )

        # TODO: Initialize your STT model here
        self.model = None

        logger.info("[template_stt] STT engine initialized")

    def analyze_audio(
        self,
        audio_bytes: bytes,
        language: str,
        thresholds: QualityThresholds,
        expected_text: Optional[str] = None,
        pronunciation_rules: Optional[List[PronunciationRuleData]] = None
    ) -> AnalyzeResult:
        """
        Transcribe audio and return quality metrics.

        TODO: Implement your transcription logic here.

        Args:
            audio_bytes: Raw audio file bytes (WAV format)
            language: Language code (e.g., "en", "de")
            thresholds: Quality thresholds (mainly used by audio engines)
            expected_text: Original segment text for comparison
            pronunciation_rules: Active pronunciation rules to filter false positives

        Returns:
            AnalyzeResult with transcription quality metrics
        """
        # TODO: Replace this placeholder implementation

        # Example: Transcribe audio
        # transcription = self.model.transcribe(audio_bytes, language)
        # confidence = self.model.get_confidence()

        # Placeholder values
        transcription = "This is a placeholder transcription."
        confidence = 85
        duration = 2.5
        word_count = len(transcription.split())

        # Build quality fields
        fields = [
            QualityField(
                key="quality.stt.confidence",
                value=confidence,
                type="percent"
            ),
            QualityField(
                key="quality.stt.transcription",
                value=transcription,
                type="text"
            ),
            QualityField(
                key="quality.stt.language",
                value=language,
                type="string"
            ),
            QualityField(
                key="quality.stt.duration",
                value=duration,
                type="seconds"
            ),
            QualityField(
                key="quality.stt.wordCount",
                value=word_count,
                type="number"
            ),
        ]

        # Check for issues
        info_blocks = {}
        issues = []

        # TODO: Add your quality checks here
        # Example: Low confidence warning
        if confidence < 70:
            issues.append(QualityInfoBlockItem(
                text="quality.stt.lowConfidence",
                severity="warning",
                details={"confidence": confidence}
            ))

        if issues:
            info_blocks["issues"] = issues

        logger.info(
            f"[template_stt] Transcription complete | "
            f"Confidence: {confidence}% | "
            f"Words: {word_count} | "
            f"Duration: {duration}s"
        )

        return AnalyzeResult(
            quality_score=confidence,
            fields=fields,
            info_blocks=info_blocks,
            top_label="quality.stt.templateEngine"  # TODO: Change i18n key
        )

    # ============= Base Class Overrides =============

    def get_available_models(self) -> List[ModelInfo]:
        """
        Return available STT models.

        TODO: Return your actual models.
        """
        self.default_model = "base"
        return [
            ModelInfo(
                name="base",
                display_name="Base Model"
            ),
            ModelInfo(
                name="large",
                display_name="Large Model"
            ),
        ]

    def load_model(self, model_name: str) -> None:
        """
        Load STT model.

        TODO: Implement model loading for your STT library.
        """
        logger.info(f"[template_stt] Loading model: {model_name}")

        # TODO: Load your model here
        # Example:
        # import whisper
        # self.model = whisper.load_model(model_name)

        self.model = True  # Placeholder
        self.model_loaded = True
        self.current_model = model_name

        logger.success(f"[template_stt] Model loaded: {model_name}")

    def unload_model(self) -> None:
        """Unload model and free resources."""
        if self.model is not None:
            logger.info("[template_stt] Unloading model")
            # TODO: Cleanup your model
            self.model = None

            # Force garbage collection
            import gc
            gc.collect()

        self.model_loaded = False
        self.current_model = None


# ============= Main Entry Point =============

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Template STT Engine Server")
    parser.add_argument("--port", type=int, required=True, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")

    args = parser.parse_args()

    server = TemplateSTTServer()
    server.run(port=args.port, host=args.host)
