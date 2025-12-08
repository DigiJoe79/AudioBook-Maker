"""
Template Text Processing Engine Server

Inherits from BaseTextServer for consistent lifecycle management.
Provides text-specific endpoint:
- /segment - Text segmentation for TTS processing

Standard endpoints from BaseEngineServer:
- /health - Health check
- /load - Load model
- /models - List available models
- /shutdown - Graceful shutdown

TODO: Rename this file's class and customize for your engine.
"""

import sys
from pathlib import Path
from typing import List, Optional

# Add parent directory to path for base_server imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from base_text_server import BaseTextServer, SegmentItem
from base_server import ModelInfo
from loguru import logger


class TemplateTextProcessor(BaseTextServer):
    """
    Template text processing engine.

    TODO: Rename this class to match your engine (e.g., MyTextProcessor).

    Text processing engines segment text into chunks suitable for TTS
    generation, ensuring sentence boundaries are preserved.
    """

    def __init__(self):
        super().__init__(
            engine_name="template_text",  # TODO: Change to your engine name
            display_name="Template Text Processor"  # TODO: Change display name
        )

        # TODO: Initialize your NLP model here
        self.nlp = None
        self.current_language: Optional[str] = None

        logger.info("[template_text] Text processing engine initialized")

    def segment_text(
        self,
        text: str,
        language: str,
        max_length: int,
        min_length: int,
        mark_oversized: bool
    ) -> List[SegmentItem]:
        """
        Segment text into chunks for TTS generation.

        TODO: Implement your segmentation logic here.

        Key principles for TTS segmentation:
        1. NEVER split sentences in the middle (breaks TTS naturalness)
        2. Combine short sentences up to max_length for better flow
        3. Mark sentences > max_length as "failed" for manual review

        Args:
            text: Input text to segment
            language: Language code for NLP model selection
            max_length: Maximum characters per segment (TTS engine limit)
            min_length: Minimum characters (merge short sentences)
            mark_oversized: Mark sentences exceeding max_length as "failed"

        Returns:
            List of SegmentItem objects
        """
        if not text or not text.strip():
            return []

        # Sanitize text
        text = self._sanitize_text(text)

        # TODO: Replace this placeholder with your NLP-based segmentation
        # Example using spaCy:
        # doc = self.nlp(text)
        # sentences = [sent.text for sent in doc.sents]

        # Placeholder: simple period-based splitting
        sentences = [s.strip() for s in text.split('.') if s.strip()]

        segments: List[SegmentItem] = []
        order_index = 0
        current_pos = 0
        current_segment_text = ""
        current_start = 0

        for sentence in sentences:
            sent_text = sentence + "."
            sent_length = len(sent_text)

            # Check if single sentence exceeds max_length
            if sent_length > max_length:
                # Save accumulated segment first
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

                # Mark oversized sentence
                segments.append(SegmentItem(
                    text=sent_text,
                    start=current_pos,
                    end=current_pos + sent_length,
                    order_index=order_index,
                    status="failed" if mark_oversized else "ok",
                    length=sent_length if mark_oversized else None,
                    max_length=max_length if mark_oversized else None,
                    issue="sentence_too_long" if mark_oversized else None
                ))
                order_index += 1
                current_start = current_pos + sent_length
                current_pos += sent_length
                continue

            # Check if adding sentence would exceed max_length
            would_exceed = current_segment_text and \
                (len(current_segment_text) + 1 + sent_length) > max_length

            if would_exceed:
                # Save current segment
                segments.append(SegmentItem(
                    text=current_segment_text.strip(),
                    start=current_start,
                    end=current_start + len(current_segment_text.strip()),
                    order_index=order_index,
                    status="ok"
                ))
                order_index += 1
                current_segment_text = sent_text
                current_start = current_pos
            else:
                # Add to current segment
                if current_segment_text:
                    current_segment_text += " " + sent_text
                else:
                    current_segment_text = sent_text
                    current_start = current_pos

            current_pos += sent_length + 1

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

    def _sanitize_text(self, text: str) -> str:
        """
        Sanitize text for TTS processing.

        TODO: Customize sanitization for your use case.
        """
        import unicodedata
        import html

        if not text:
            return ""

        # Unicode normalization (NFC)
        text = unicodedata.normalize('NFC', text)

        # Remove BOM and zero-width characters
        text = text.replace('\ufeff', '')
        text = text.replace('\u200b', '')
        text = text.replace('\u200c', '')
        text = text.replace('\u200d', '')

        # Normalize whitespace
        text = ' '.join(text.split())

        # Decode HTML entities
        text = html.unescape(text)

        # Normalize quotes
        text = text.replace('"', '"').replace('"', '"')
        text = text.replace(''', "'").replace(''', "'")

        return text.strip()

    # ============= Base Class Overrides =============

    def get_available_models(self) -> List[ModelInfo]:
        """
        Return available models/languages.

        TODO: Return your actual models.
        """
        self.default_model = "default"
        return [
            ModelInfo(
                name="default",
                display_name="Default Configuration"
            ),
            # Example: Language-specific models
            # ModelInfo(name="en", display_name="English"),
            # ModelInfo(name="de", display_name="German"),
        ]

    def load_model(self, model_name: str) -> None:
        """
        Load text processing model.

        TODO: Implement model loading for your NLP library.
        """
        logger.info(f"[template_text] Loading model: {model_name}")

        # TODO: Load your NLP model here
        # Example:
        # import spacy
        # self.nlp = spacy.load(model_name)

        self.nlp = True  # Placeholder
        self.current_language = model_name
        self.model_loaded = True
        self.current_model = model_name

        logger.success(f"[template_text] Model loaded: {model_name}")

    def unload_model(self) -> None:
        """Unload model and free resources."""
        logger.info("[template_text] Unloading model")

        if self.nlp is not None:
            self.nlp = None

        self.current_language = None
        self.model_loaded = False
        self.current_model = None

        # Force garbage collection
        import gc
        gc.collect()


# ============= Main Entry Point =============

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Template Text Processing Engine Server")
    parser.add_argument("--port", type=int, required=True, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")

    args = parser.parse_args()

    server = TemplateTextProcessor()
    server.run(port=args.port, host=args.host)
