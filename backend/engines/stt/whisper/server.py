"""
Whisper STT Engine Server

Inherits from BaseQualityServer for unified quality analysis.
Provides quality analysis via abstract method implementation:
- analyze_audio() - Whisper transcription with confidence scoring

Standard endpoints from BaseQualityServer:
- /analyze - Quality analysis endpoint (provided by base class)
- /health - Health check
- /load - Load model
- /models - List available Whisper models
- /shutdown - Graceful shutdown
"""
import sys
import os
from pathlib import Path
from typing import Optional, List, Dict, Any
import argparse
import yaml
import warnings
import contextlib
import io

# Suppress warnings
warnings.filterwarnings('ignore')

# Set CUDA_PATH for Triton if not already set
if 'CUDA_PATH' not in os.environ:
    cuda_locations = [
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.5",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.1",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.0",
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8",
    ]
    for cuda_path in cuda_locations:
        if os.path.exists(cuda_path):
            os.environ['CUDA_PATH'] = cuda_path
            break

# Fix Windows path length issues with Triton
import tempfile  # noqa: E402
TEMP_DIR = Path("C:/Temp/whisper_cache")
TEMP_DIR.mkdir(parents=True, exist_ok=True)
os.environ['TMPDIR'] = str(TEMP_DIR)
os.environ['TEMP'] = str(TEMP_DIR)
os.environ['TMP'] = str(TEMP_DIR)
os.environ['TRITON_CACHE_DIR'] = str(TEMP_DIR / "triton")
tempfile.tempdir = str(TEMP_DIR)

# Add paths for imports
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Imports after environment setup
import whisper  # noqa: E402
import torch  # noqa: E402
import numpy as np  # noqa: E402
from loguru import logger  # noqa: E402

# Whisper package version (for health endpoint)
WHISPER_VERSION = getattr(whisper, '__version__', 'unknown')

import re  # noqa: E402
from base_server import ModelInfo, ModelField  # noqa: E402
from base_quality_server import (  # noqa: E402
    BaseQualityServer,
    AnalyzeResult,
    QualityField,
    QualityInfoBlockItem,
    QualityThresholds,
    PronunciationRuleData
)
import models as whisper_models  # noqa: E402


# ============= Text Comparison Functions =============

def _is_word_affected_by_rule(word: str, rules: List[PronunciationRuleData]) -> bool:
    """Check if word is affected by any active pronunciation rule."""
    word_lower = word.lower()
    for rule in rules:
        if not rule.is_active:
            continue
        if rule.is_regex:
            try:
                if re.search(rule.pattern, word_lower, re.IGNORECASE):
                    return True
            except re.error:
                continue
        else:
            if rule.pattern.lower() in word_lower or word_lower in rule.pattern.lower():
                return True
    return False


def _is_shifted_sequence(
    exp_words: List[str],
    act_words: List[str],
    i_exp: int,
    i_act: int,
    window: int = 5
) -> tuple:
    """Detect sequence shifts (alignment issues) in both directions."""
    threshold = window * 0.8

    # Forward shift: expected has extra word
    if i_exp + window < len(exp_words) and i_act + window - 1 < len(act_words):
        forward_matches = sum(
            1 for j in range(window)
            if i_exp + 1 + j < len(exp_words)
            and i_act + j < len(act_words)
            and exp_words[i_exp + 1 + j] == act_words[i_act + j]
        )
        if forward_matches >= threshold:
            return ("forward", None)

    # Reverse shift: actual has extra word
    if i_exp + window - 1 < len(exp_words) and i_act + window < len(act_words):
        reverse_matches = sum(
            1 for j in range(window)
            if i_exp + j < len(exp_words)
            and i_act + 1 + j < len(act_words)
            and exp_words[i_exp + j] == act_words[i_act + 1 + j]
        )
        if reverse_matches >= threshold:
            return ("reverse", None)

    return (None, None)


def _detect_transcription_issues(
    expected_text: str,
    actual_text: str,
    rules: List[PronunciationRuleData],
    whisper_words: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Compare expected text vs transcription and detect issues.

    Returns list of issues: [{"expected": str, "detected": str, "confidence": float}, ...]
    """
    issues = []

    expected_lower = expected_text.strip().lower()
    actual_lower = actual_text.strip().lower()

    # Early exit if texts match
    if expected_lower == actual_lower:
        return issues

    # Normalize: remove punctuation
    punct_pattern = r'["""\'\u201e\u201c\u00bb\u00ab.,!?;:()\[\]{}\-–—\u2013\u2014/_]'
    expected_norm = re.sub(punct_pattern, '', expected_lower)
    actual_norm = re.sub(punct_pattern, '', actual_lower)

    exp_words_norm = expected_norm.split()
    act_words_norm = actual_norm.split()
    exp_words_orig = expected_lower.split()
    act_words_orig = actual_lower.split()

    i_exp = 0
    i_act = 0

    while i_exp < len(exp_words_norm) and i_act < len(act_words_norm):
        exp_norm = exp_words_norm[i_exp]
        act_norm = act_words_norm[i_act]

        exp_orig = exp_words_orig[i_exp] if i_exp < len(exp_words_orig) else exp_norm
        act_orig = act_words_orig[i_act] if i_act < len(act_words_orig) else act_norm

        if exp_norm != act_norm:
            # Check pronunciation rules first
            if _is_word_affected_by_rule(exp_norm, rules) or _is_word_affected_by_rule(act_norm, rules):
                i_exp += 1
                i_act += 1
                continue

            # Check for shifts
            shift_type, _ = _is_shifted_sequence(exp_words_norm, act_words_norm, i_exp, i_act)
            if shift_type == "forward":
                i_exp += 1
                continue
            elif shift_type == "reverse":
                i_act += 1
                continue

            # Real mismatch
            word_conf = 0.5
            if i_act < len(whisper_words):
                word_conf = whisper_words[i_act].get('confidence', 0.5)

            issues.append({
                "expected": exp_orig,
                "detected": act_orig,
                "confidence": word_conf
            })

        i_exp += 1
        i_act += 1

    # Check for incomplete transcription
    remaining = len(exp_words_norm) - i_exp
    if remaining > 5:
        issues.append({
            "type": "incomplete",
            "missing_words": remaining,
            "confidence": 0.0
        })

    return issues


class WhisperServer(BaseQualityServer):
    """
    Whisper STT Engine Server

    Provides speech-to-text transcription with quality analysis.
    Inherits from BaseQualityServer for unified quality format.
    """

    def __init__(self):
        super().__init__(
            engine_name="whisper",
            display_name="Whisper STT",
            engine_type="stt"
        )

        # Load engine config
        self.config = self._load_engine_config()

        # Override device detection
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        # Whisper model
        self.whisper_model: Optional[Any] = None

        logger.info(f"[whisper] Server initialized | Device: {self.device}")

    def _load_engine_config(self) -> Dict[str, Any]:
        """Load engine.yaml configuration."""
        config_file = Path(__file__).parent / "engine.yaml"
        with open(config_file, 'r') as f:
            return yaml.safe_load(f)

    # ============= BaseEngineServer Abstract Methods =============

    def load_model(self, model_name: str) -> None:
        """Load a Whisper model."""
        # Validate model name
        valid_models = [m['name'] for m in self.config['models']]
        if model_name not in valid_models:
            raise ValueError(f"Invalid model: {model_name}. Valid: {valid_models}")

        # Unload previous model
        if self.whisper_model is not None:
            del self.whisper_model
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        # Load new model
        logger.info(f"[whisper] Loading model '{model_name}' on {self.device}...")
        self.whisper_model = whisper.load_model(model_name, device=self.device)
        self.current_model = model_name
        self.model_loaded = True

        logger.info(f"[whisper] Model '{model_name}' loaded successfully")

    def unload_model(self) -> None:
        """Unload current model and free resources."""
        if self.whisper_model is not None:
            del self.whisper_model
            self.whisper_model = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("[whisper] Model unloaded")

        self.current_model = None
        self.model_loaded = False

    def get_package_version(self) -> str:
        """Return whisper package version for health endpoint"""
        return WHISPER_VERSION

    def get_available_models(self) -> List[ModelInfo]:
        """Return available Whisper models with metadata."""
        models = []
        # All Whisper models support the same languages
        supported_languages = self.config.get('supported_languages', [])

        for model_cfg in self.config.get('models', []):
            fields = []

            # Add metadata fields if available
            if 'size_mb' in model_cfg:
                fields.append(ModelField(key="size_mb", value=model_cfg['size_mb'], field_type="number"))
            if 'speed' in model_cfg:
                fields.append(ModelField(key="speed", value=model_cfg['speed'], field_type="string"))
            if 'accuracy' in model_cfg:
                fields.append(ModelField(key="accuracy", value=model_cfg['accuracy'], field_type="string"))

            models.append(ModelInfo(
                name=model_cfg['name'],
                display_name=model_cfg.get('display_name', model_cfg['name']),
                languages=supported_languages,  # All Whisper models are multilingual
                fields=fields
            ))

        # Set default model
        self.default_model = self.config.get('default_model', 'base')

        return models

    # ============= BaseQualityServer Abstract Method =============

    def analyze_audio(
        self,
        audio_bytes: bytes,
        language: str,
        thresholds: QualityThresholds,
        expected_text: Optional[str] = None,
        pronunciation_rules: Optional[List[PronunciationRuleData]] = None
    ) -> AnalyzeResult:
        """
        Analyze audio with Whisper transcription and text comparison.

        Args:
            audio_bytes: Raw audio file bytes (WAV format)
            language: Language code for transcription
            thresholds: Quality thresholds (not used by Whisper - confidence-based only)
            expected_text: Original segment text for comparison
            pronunciation_rules: Active pronunciation rules to filter false positives

        Returns:
            AnalyzeResult with confidence score and detected issues
        """
        # Run Whisper analysis
        result = self._perform_whisper_analysis(audio_bytes, language)

        # Build fields (without transcription - only metadata)
        # Keys are suffixes - Frontend prepends "quality.fields."
        fields = [
            QualityField(key="confidence", value=result.confidence, type="percent"),
            QualityField(key="language", value=result.language, type="string"),
        ]

        info_blocks = {}
        quality_score = result.confidence

        # Perform text comparison if expected_text provided
        if expected_text:
            rules = pronunciation_rules or []
            whisper_words = [{"confidence": w.confidence} for w in result.words]

            issues = _detect_transcription_issues(
                expected_text=expected_text,
                actual_text=result.transcription,
                rules=rules,
                whisper_words=whisper_words
            )

            if issues:
                # Add issues to info_blocks
                # Text keys are suffixes - Frontend prepends "quality.issues."
                issue_items = []
                for issue in issues:
                    if issue.get("type") == "incomplete":
                        issue_items.append(QualityInfoBlockItem(
                            text="incompleteTranscription",
                            severity="error",
                            details={"missingWords": issue["missing_words"]}
                        ))
                    else:
                        issue_items.append(QualityInfoBlockItem(
                            text="wordMismatch",
                            severity="warning" if issue['confidence'] > 0.3 else "error",
                            details={
                                "expected": issue["expected"],
                                "detected": issue["detected"],
                                "confidence": issue["confidence"]
                            }
                        ))
                info_blocks["textDeviations"] = issue_items

                # Reduce quality score based on number of issues
                issue_penalty = min(len(issues) * 5, 40)  # Max 40 point penalty
                quality_score = max(0, quality_score - issue_penalty)

                logger.info(
                    f"[whisper] Text comparison: {len(issues)} issues found, "
                    f"score adjusted from {result.confidence} to {quality_score}"
                )
            else:
                # Perfect match - add info
                fields.append(QualityField(
                    key="textMatch",
                    value="perfect",
                    type="string"
                ))

        return AnalyzeResult(
            quality_score=quality_score,
            fields=fields,
            info_blocks=info_blocks,
            top_label="whisperTranscription"  # Frontend: quality.topLabels.whisperTranscription
        )

    # ============= Internal Analysis Methods =============

    def _perform_whisper_analysis(
        self,
        audio_data: bytes,
        language: str,
        model_name: Optional[str] = None
    ) -> whisper_models.AnalyzeResponse:
        """Analyze audio with Whisper transcription."""
        import tempfile

        try:
            # Load model if needed
            if model_name and model_name != self.current_model:
                self.load_model(model_name)

            # Ensure model is loaded
            if self.whisper_model is None:
                default_model = self.config.get('default_model', 'base')
                self.load_model(default_model)

            # Write to temp file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_file.write(audio_data)
                temp_path = temp_file.name

            try:
                # Run Whisper
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    result = self.whisper_model.transcribe(
                        temp_path,
                        language=language,
                        word_timestamps=True,
                        verbose=False
                    )
            finally:
                # Cleanup temp file
                if os.path.exists(temp_path):
                    try:
                        os.unlink(temp_path)
                    except OSError as e:
                        logger.warning(f"Failed to cleanup temp file {temp_path}: {e}")

            # Extract results
            transcription = result['text'].strip()
            segments = result.get('segments', [])

            # Calculate confidence
            if segments:
                confidences = [
                    np.clip(np.exp(seg.get('avg_logprob', -1.0)), 0.0, 1.0)
                    for seg in segments
                ]
                overall_confidence = round(float(np.mean(confidences)) * 100)
            else:
                overall_confidence = 90

            # Extract words
            words = []
            for segment in segments:
                segment_confidence = np.clip(np.exp(segment.get('avg_logprob', -1.0)), 0.0, 1.0)

                for word_data in segment.get('words', []):
                    if not word_data.get('word') or word_data.get('start') is None:
                        continue

                    if 'probability' in word_data and word_data['probability'] is not None:
                        word_confidence = float(np.clip(np.exp(word_data['probability']), 0.0, 1.0))
                    else:
                        word_confidence = float(segment_confidence)

                    words.append(whisper_models.WordAnalysis(
                        word=word_data['word'].strip(),
                        confidence=word_confidence,
                        start=float(word_data['start']),
                        end=float(word_data['end'])
                    ))

            return whisper_models.AnalyzeResponse(
                transcription=transcription,
                confidence=overall_confidence,
                words=words,
                language=language,
                duration=result.get('duration', 0.0)
            )

        except Exception as e:
            import traceback
            logger.error(f"[whisper] Analysis failed: {e}\n{traceback.format_exc()}")
            raise


# ============= Main Entry Point =============

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Whisper STT Engine Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8767, help="Port to bind to")

    args = parser.parse_args()

    server = WhisperServer()
    server.run(host=args.host, port=args.port)
