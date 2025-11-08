"""
Text segmentation service using spaCy
Splits text into natural segments (sentences or paragraphs) for TTS generation
"""
import re
from typing import List, Dict, Optional, Any
import spacy
from loguru import logger


class TextSegmenter:
    """
    Text segmentation using spaCy for natural language processing
    """

    def __init__(self, language: str = "de", model_name: Optional[str] = None):
        """
        Initialize the text segmenter

        Args:
            language: Language code (de, en)
            model_name: Optional spaCy model name (auto-detected if None)
        """
        self.language = language

        # Auto-detect spaCy model based on language
        if model_name is None:
            model_name = self._get_default_model(language)

        self.model_name = model_name
        self.nlp = None

        try:
            self._load_model()
        except OSError as e:
            logger.error(f"Failed to load spaCy model '{model_name}': {e}")
            logger.info(f"Please install the model: python -m spacy download {model_name}")
            raise

    def _get_default_model(self, language: str) -> str:
        """Get default spaCy model for language"""
        models = {
            "de": "de_core_news_sm",
            "en": "en_core_web_sm",
            "es": "es_core_news_sm",
            "fr": "fr_core_news_sm",
            "it": "it_core_news_sm",
        }
        return models.get(language, "en_core_web_sm")

    def _load_model(self):
        """Load spaCy model"""
        logger.info(f"Loading spaCy model: {self.model_name}")
        self.nlp = spacy.load(self.model_name)
        logger.info("spaCy model loaded successfully")

    def segment_by_sentences(
        self,
        text: str,
        min_length: int = 10,
        max_length: int = 500
    ) -> List[Dict[str, Any]]:
        """
        Segment text into sentences

        Args:
            text: Input text to segment
            min_length: Minimum characters per segment (merge short sentences)
            max_length: Maximum characters per segment (split long sentences)

        Returns:
            List of segment dictionaries with 'text' and 'order_index'
        """
        if not self.nlp:
            raise RuntimeError("spaCy model not loaded")

        # Process text with spaCy
        doc = self.nlp(text)

        segments = []
        current_segment = ""
        order_index = 0

        for sent in doc.sents:
            sent_text = sent.text.strip()

            if not sent_text:
                continue

            # If adding this sentence exceeds max_length, save current and start new
            if current_segment and len(current_segment) + len(sent_text) > max_length:
                segments.append({
                    "text": current_segment.strip(),
                    "order_index": order_index
                })
                order_index += 1
                current_segment = sent_text
            else:
                # Add to current segment with space
                if current_segment:
                    current_segment += " " + sent_text
                else:
                    current_segment = sent_text

            # If current segment meets min_length, we can optionally save it
            # But we'll continue accumulating for now

        # Add remaining segment
        if current_segment.strip():
            segments.append({
                "text": current_segment.strip(),
                "order_index": order_index
            })

        logger.info(f"Segmented text into {len(segments)} sentence-based segments")
        return segments

    def segment_by_paragraphs(self, text: str) -> List[Dict[str, Any]]:
        """
        Segment text by paragraphs (double newlines)

        Args:
            text: Input text to segment

        Returns:
            List of segment dictionaries with 'text' and 'order_index'
        """
        # Split by double newlines (paragraph breaks)
        paragraphs = re.split(r'\n\s*\n', text)

        segments = []
        for idx, para in enumerate(paragraphs):
            para = para.strip()
            if para:
                segments.append({
                    "text": para,
                    "order_index": idx
                })

        logger.info(f"Segmented text into {len(segments)} paragraph-based segments")
        return segments

    def segment_smart(
        self,
        text: str,
        prefer_paragraphs: bool = True,
        min_length: int = 50,
        max_length: int = 500
    ) -> List[Dict[str, Any]]:
        """
        Smart segmentation: Use paragraphs if available, otherwise sentences

        Args:
            text: Input text to segment
            prefer_paragraphs: Try paragraph segmentation first
            min_length: Minimum characters per segment
            max_length: Maximum characters per segment

        Returns:
            List of segment dictionaries with 'text' and 'order_index'
        """
        if prefer_paragraphs:
            # Check if text has paragraph breaks
            para_segments = self.segment_by_paragraphs(text)

            # If paragraphs are reasonable length, use them
            if para_segments and all(
                min_length <= len(seg["text"]) <= max_length
                for seg in para_segments
            ):
                return para_segments

        # Fall back to sentence segmentation
        return self.segment_by_sentences(text, min_length, max_length)

    def segment_by_length(
        self,
        text: str,
        target_length: int = 300,
        break_on_sentence: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Segment text by approximate length, respecting sentence boundaries

        Args:
            text: Input text to segment
            target_length: Target characters per segment
            break_on_sentence: Try to break on sentence boundaries

        Returns:
            List of segment dictionaries with 'text' and 'order_index'
        """
        if not break_on_sentence:
            # Simple character-based splitting
            segments = []
            for i in range(0, len(text), target_length):
                chunk = text[i:i+target_length].strip()
                if chunk:
                    segments.append({
                        "text": chunk,
                        "order_index": len(segments)
                    })
            return segments

        # Use sentence segmentation with target length
        return self.segment_by_sentences(
            text,
            min_length=target_length // 2,
            max_length=target_length * 2
        )


# Global instance (lazy loaded)
_segmenter_cache: Dict[str, TextSegmenter] = {}


def get_segmenter(language: str = "de") -> TextSegmenter:
    """
    Get or create a text segmenter for the specified language

    Args:
        language: Language code (de, en, etc.)

    Returns:
        TextSegmenter instance
    """
    if language not in _segmenter_cache:
        _segmenter_cache[language] = TextSegmenter(language)

    return _segmenter_cache[language]
