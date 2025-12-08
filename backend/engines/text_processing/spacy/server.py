"""
spaCy Text Processing Server

Standalone FastAPI server for spaCy text segmentation.
Runs in separate VENV with spaCy-specific dependencies.

Features:
- CPU-only processing (no CUDA overhead for simple text segmentation)
- MD models for balanced speed/accuracy
- Intelligent sentence-boundary splitting (NEVER split within sentences)
- Text sanitization for TTS consistency
- Failed status for sentences exceeding TTS engine limits
"""
import warnings

# Suppress PyTorch FutureWarning about weights_only (from thinc/spacy-transformers)
# This is a known warning that will be resolved in future thinc versions
warnings.filterwarnings("ignore", message=".*weights_only=False.*")

from pathlib import Path  # noqa: E402
from typing import Dict, Any, List, Optional  # noqa: E402
from loguru import logger  # noqa: E402
import sys  # noqa: E402
import html  # noqa: E402
import unicodedata  # noqa: E402
import yaml  # noqa: E402

import spacy  # noqa: E402
from spacy.language import Language  # noqa: E402

# spaCy package version (for health endpoint)
SPACY_VERSION = getattr(spacy, '__version__', 'unknown')

# Add parent directory to path to import base_text_server
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from base_text_server import BaseTextServer, SegmentItem, ModelInfo  # noqa: E402


# ============= Text Sanitization =============

def sanitize_text_for_tts(text: str) -> str:
    """
    Sanitize text for TTS generation and sentence segmentation

    Applies consistent normalization for:
    - Unicode forms (NFC)
    - Whitespace (newlines, tabs -> spaces)
    - BOM and control characters
    - HTML entities
    - Smart quotes -> standard quotes

    This ensures consistent behavior across Preview and Import pipelines.

    Args:
        text: Raw input text (may contain markdown artifacts, HTML entities, etc.)

    Returns:
        Sanitized text ready for spaCy processing and TTS generation
    """
    if not text:
        return ""

    # 1. Unicode normalization (NFC - Canonical Composition)
    # Ensures "cafe" is always represented the same way
    text = unicodedata.normalize('NFC', text)

    # 2. Remove BOM (Byte Order Mark) and zero-width characters
    text = text.replace('\ufeff', '')  # BOM
    text = text.replace('\u200b', '')  # Zero-width space
    text = text.replace('\u200c', '')  # Zero-width non-joiner
    text = text.replace('\u200d', '')  # Zero-width joiner
    text = text.replace('\u00ad', '')  # Soft hyphen
    text = text.replace('\ufdd0', '')  # Non-character

    # 3. Normalize whitespace (newlines, tabs, multiple spaces -> single space)
    # Critical for Markdown "hard wraps" that break mid-sentence
    text = ' '.join(text.split())

    # 4. Decode HTML entities (in case Markdown parser left any)
    text = html.unescape(text)

    # 5. Normalize quotes for TTS consistency
    # Smart quotes -> standard ASCII quotes
    text = text.replace('"', '"').replace('"', '"')  # Curly double quotes
    text = text.replace(''', "'").replace(''', "'")  # Curly single quotes
    text = text.replace('„', '"').replace('‟', '"')  # German quotes
    text = text.replace('‚', "'").replace('‛', "'")  # German single quotes
    text = text.replace('«', '"').replace('»', '"')  # French guillemets
    text = text.replace('‹', "'").replace('›', "'")  # Single guillemets

    # Normalize ellipsis
    text = text.replace('...', '...')  # Ellipsis character -> three dots

    # Remove any remaining control characters (except newline/tab which are already normalized)
    text = ''.join(char for char in text if unicodedata.category(char)[0] != 'C')

    return text.strip()


# ============= spaCy Server Implementation =============

class SpacyServer(BaseTextServer):
    """
    spaCy Text Processing Server

    Optimized for audiobook production with TTS engines:
    - CPU-only (CUDA has no benefit for text segmentation)
    - Uses MD models for balanced speed/accuracy
    - Never splits sentences in the middle (maintains TTS quality)
    - Marks oversized sentences as 'failed' for manual review
    """

    def __init__(self):
        super().__init__(
            engine_name="spacy",
            display_name="spaCy Text Processor"
        )

        # spaCy-specific state
        self.nlp: Optional[Language] = None
        self.current_language: Optional[str] = None
        self.current_model_name: Optional[str] = None

        # Load configuration from engine.yaml
        self.config = self._load_engine_config()
        self.device = self.config.get("device", "cpu")
        self.model_tier = self.config.get("model_tier", "sm")
        self.models_mapping = self.config.get("spacy_models", {})

        # Note: /segment endpoint is now provided by BaseTextServer
        # Note: /models endpoint is provided by BaseEngineServer

        logger.debug(
            f"[spacy] Text processing server initialized | "
            f"Device: {self.device} | Model tier: {self.model_tier}"
        )

    def _load_engine_config(self) -> Dict[str, Any]:
        """Load configuration from engine.yaml"""
        config_path = Path(__file__).parent / "engine.yaml"
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f)
        except Exception as e:
            logger.warning(f"[spacy] Failed to load engine.yaml: {e}")
            return {}

    def _get_model_for_language(self, language: str) -> str:
        """
        Get spaCy model name for language (MD tier only)

        Uses MD models for balanced speed/accuracy. Falls back to SM if MD not available.

        Args:
            language: Language code (e.g., "de", "en")

        Returns:
            spaCy model name (e.g., "de_core_news_md")
        """
        # Check what's installed for this language
        try:
            import spacy.util
            installed_models = spacy.util.get_installed_models()
            lang_models = [m for m in installed_models if m.startswith(f"{language}_")]

            if lang_models:
                # Prefer MD, fallback to SM, then any available
                for tier_suffix in ["_md", "_sm"]:
                    for model in lang_models:
                        if model.endswith(tier_suffix):
                            logger.debug(f"[spacy] Selected installed model: {model}")
                            return model
                # No MD/SM found, use first available
                logger.debug(f"[spacy] Using first installed model: {lang_models[0]}")
                return lang_models[0]
        except Exception as e:
            logger.warning(f"[spacy] Failed to check installed models: {e}")

        # Fallback: Use MD model from config
        md_models = self.models_mapping.get("md", {})
        if language in md_models:
            return md_models[language]

        # Last resort: construct default model name
        default_model = f"{language}_core_news_md"
        logger.warning(f"[spacy] Unknown language {language}, trying {default_model}")
        return default_model

    def segment_text(
        self,
        text: str,
        language: str,
        max_length: int,
        min_length: int,
        mark_oversized: bool
    ) -> List[SegmentItem]:
        """
        Segment text into sentences using spaCy (implementation for BaseTextServer)

        Args:
            text: Input text to segment
            language: Language code for model selection
            max_length: Maximum characters per segment
            min_length: Minimum characters (merge short sentences)
            mark_oversized: Mark sentences exceeding max_length as "failed"

        Returns:
            List of SegmentItem objects
        """
        # Ensure correct model is loaded for language
        if self.current_language != language:
            model_name = self._get_model_for_language(language)
            self.load_model(model_name)

        # Segment text using spaCy sentence segmentation
        return self._segment_by_sentences(
            text=text,
            min_length=min_length,
            max_length=max_length,
            mark_oversized=mark_oversized
        )

    def get_available_models(self) -> List[ModelInfo]:
        """Return available spaCy models installed in this VENV"""
        try:
            import spacy.util
            installed_models = spacy.util.get_installed_models()

            models = []
            for model_name in sorted(installed_models):
                # Extract language from model name (e.g., "de_core_news_sm" → "de")
                lang = model_name.split("_")[0] if "_" in model_name else model_name
                models.append(ModelInfo(
                    name=model_name,
                    display_name=model_name,
                    languages=[lang]
                ))

            logger.debug(f"[spacy] Found {len(models)} installed models")
            return models

        except Exception as e:
            logger.error(f"[spacy] Failed to get installed models: {e}")
            return []

    def load_model(self, model_name: str) -> None:
        """
        Load spaCy model with optimizations

        Optimizations:
        - Enable GPU if configured and available
        - Use senter instead of parser for non-transformer models (10x faster)
        - Keep parser for transformer models (needed for accuracy)

        Args:
            model_name: Language code ("en", "de") OR full model name ("en_core_web_sm")
        """
        # If model_name is a language code, get the full model name
        if len(model_name) == 2 or (len(model_name) == 5 and model_name[2] == "-"):
            # Looks like a language code (e.g., "de", "en", "zh-cn")
            language_code = model_name.replace("-", "_")
            spacy_model = self._get_model_for_language(language_code)
        else:
            # Full model name provided
            spacy_model = model_name
            # Extract language code from model name
            language_code = model_name.split('_')[0] if '_' in model_name else model_name[:2]

        try:
            logger.debug(f"[spacy] Loading model: {spacy_model}")

            # Load model with pipeline optimization (CPU only, no CUDA)
            # Try to use senter instead of parser for faster processing
            try:
                self.nlp = spacy.load(spacy_model, exclude=["parser"])
                if "senter" in self.nlp.pipe_names:
                    self.nlp.enable_pipe("senter")
                elif self.nlp.has_pipe("senter"):
                    self.nlp.enable_pipe("senter")
                else:
                    # senter not available, reload with parser
                    logger.debug("[spacy] Senter not available, reloading with parser")
                    self.nlp = spacy.load(spacy_model)
                logger.debug("[spacy] Loaded model with optimized pipeline")
            except Exception:
                # Fallback: Load full model
                logger.warning("[spacy] Pipeline optimization failed, loading full model")
                self.nlp = spacy.load(spacy_model)

            # Disable unnecessary pipeline components
            disabled = []
            keep_pipes = {"tok2vec", "tagger", "parser", "senter"}
            for pipe_name in list(self.nlp.pipe_names):
                if pipe_name not in keep_pipes:
                    disabled.append(pipe_name)

            if disabled:
                self.nlp.disable_pipes(*disabled)
                logger.debug(f"[spacy] Disabled unnecessary pipes: {disabled}")

            self.current_language = language_code
            self.current_model_name = spacy_model

            logger.debug(f"[spacy] Model loaded successfully: {spacy_model}")

        except OSError as e:
            raise RuntimeError(
                f"Failed to load spaCy model '{spacy_model}'. "
                f"Please run: python -m spacy download {spacy_model}"
            ) from e

    def unload_model(self) -> None:
        """Unload spaCy model and free resources"""
        if self.nlp:
            self.nlp = None
            self.current_language = None
            self.current_model_name = None
            logger.info("[spacy] Model unloaded")

    def get_package_version(self) -> str:
        """Return spaCy package version for health endpoint"""
        return SPACY_VERSION

    def _segment_by_sentences(
        self,
        text: str,
        min_length: int = 10,
        max_length: int = 250,
        mark_oversized: bool = True
    ) -> List[SegmentItem]:
        """
        Segment text into sentences with intelligent boundary handling

        CRITICAL FOR TTS QUALITY:
        - NEVER splits sentences in the middle (breaks TTS naturalness)
        - Combines short sentences up to max_length
        - Marks individual sentences > max_length as 'failed' for manual review

        Args:
            text: Input text to segment
            min_length: Minimum characters per segment (merge short sentences)
            max_length: Maximum characters per segment (from TTS engine constraints)
            mark_oversized: Mark sentences exceeding max_length as 'failed'

        Returns:
            List of SegmentItem objects
        """
        if not self.nlp:
            raise RuntimeError("Model not loaded")

        # Sanitize text for consistent TTS processing
        sanitized_text = sanitize_text_for_tts(text)

        if not sanitized_text:
            return []

        # Process text with spaCy
        logger.debug(f"[spacy] Processing {len(sanitized_text)} chars with {self.current_model_name}")
        doc = self.nlp(sanitized_text)

        segments: List[SegmentItem] = []
        current_segment_text = ""
        current_start = 0
        order_index = 0

        for sent in doc.sents:
            sent_text = sent.text.strip()

            if not sent_text:
                continue

            sent_length = len(sent_text)

            # CRITICAL CHECK: Is this single sentence too long?
            if sent_length > max_length:
                # Save current accumulated segment first (if any)
                if current_segment_text:
                    segments.append(SegmentItem(
                        text=current_segment_text.strip(),
                        start=current_start,
                        end=current_start + len(current_segment_text.strip()),
                        order_index=order_index,
                        status="ok"
                    ))
                    order_index += 1
                    current_segment_text = ""

                # Mark oversized sentence as 'failed' for manual review
                if mark_oversized:
                    segments.append(SegmentItem(
                        text=sent_text,
                        start=sent.start_char,
                        end=sent.end_char,
                        order_index=order_index,
                        status="failed",
                        length=sent_length,
                        max_length=max_length,
                        issue="sentence_too_long"
                    ))
                    logger.debug(
                        f"[spacy] Sentence exceeds max_length ({sent_length}/{max_length} chars): "
                        f"{sent_text[:50]}..."
                    )
                else:
                    # Add as-is without marking as failed
                    segments.append(SegmentItem(
                        text=sent_text,
                        start=sent.start_char,
                        end=sent.end_char,
                        order_index=order_index,
                        status="ok"
                    ))

                order_index += 1
                current_start = sent.end_char
                continue

            # Check if adding this sentence would exceed max_length
            would_exceed = current_segment_text and (len(current_segment_text) + 1 + sent_length) > max_length

            if would_exceed:
                # Save current segment and start new one
                segments.append(SegmentItem(
                    text=current_segment_text.strip(),
                    start=current_start,
                    end=current_start + len(current_segment_text.strip()),
                    order_index=order_index,
                    status="ok"
                ))
                order_index += 1
                current_segment_text = sent_text
                current_start = sent.start_char
            else:
                # Add to current segment with space
                if current_segment_text:
                    current_segment_text += " " + sent_text
                else:
                    current_segment_text = sent_text
                    current_start = sent.start_char

        # Add remaining segment
        if current_segment_text.strip():
            segments.append(SegmentItem(
                text=current_segment_text.strip(),
                start=current_start,
                end=current_start + len(current_segment_text.strip()),
                order_index=order_index,
                status="ok"
            ))

        return segments


# ============= Main Entry Point =============

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="spaCy Text Processing Server")
    parser.add_argument("--port", type=int, default=8770, help="Port to run server on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    args = parser.parse_args()

    server = SpacyServer()
    server.run(port=args.port, host=args.host)
