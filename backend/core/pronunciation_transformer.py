"""Text transformation for pronunciation correction."""
import re
from typing import List, Tuple, Optional
from dataclasses import dataclass
from loguru import logger

from models.pronunciation_models import PronunciationRule

@dataclass
class TransformationResult:
    """Result of applying pronunciation rules."""
    original_text: str
    transformed_text: str
    rules_applied: List[str]
    length_before: int
    length_after: int
    would_exceed_limit: bool = False
    chunks_required: int = 1

class PronunciationTransformer:
    """Transforms text using pronunciation rules."""

    def apply_rules(
        self,
        text: str,
        rules: List[PronunciationRule],
        max_length: Optional[int] = None
    ) -> TransformationResult:
        """Apply pronunciation rules to text."""
        original_text = text
        transformed_text = text
        rules_applied = []

        # Apply rules in order (already sorted by priority)
        for rule in rules:
            if not rule.is_active:
                continue

            old_text = transformed_text

            try:
                if rule.is_regex:
                    # Regex replacement
                    pattern = re.compile(rule.pattern)

                    # Convert JavaScript-style backreferences ($1, $2) to Python-style (\1, \2)
                    # This allows users to use the more common $1 syntax from JavaScript
                    replacement = rule.replacement
                    replacement = re.sub(r'\$(\d+)', r'\\\1', replacement)

                    transformed_text = pattern.sub(replacement, transformed_text)
                else:
                    # Simple string replacement
                    transformed_text = transformed_text.replace(
                        rule.pattern,
                        rule.replacement
                    )

                # Track if rule was applied
                if old_text != transformed_text:
                    rules_applied.append(f"{rule.pattern} → {rule.replacement}")
                    logger.debug(f"Applied rule: {rule.pattern} → {rule.replacement}")

            except re.error as e:
                logger.error(f"Invalid regex pattern '{rule.pattern}': {e}")
                continue

        # Calculate lengths
        length_before = len(original_text)
        length_after = len(transformed_text)

        # Check if would exceed limit
        would_exceed_limit = False
        chunks_required = 1

        if max_length and length_after > max_length:
            would_exceed_limit = True
            chunks_required = (length_after + max_length - 1) // max_length

        return TransformationResult(
            original_text=original_text,
            transformed_text=transformed_text,
            rules_applied=rules_applied,
            length_before=length_before,
            length_after=length_after,
            would_exceed_limit=would_exceed_limit,
            chunks_required=chunks_required
        )

    def smart_split(self, text: str, max_length: int) -> List[str]:
        """Split text intelligently at sentence boundaries.

        Returns chunks that can be joined directly (preserving spacing).
        """
        if len(text) <= max_length:
            return [text]

        chunks = []

        # Split at sentence boundaries while preserving the space after punctuation
        sentence_pattern = re.compile(r'(?<=[.!?])\s+')
        parts = sentence_pattern.split(text)

        current_chunk = ""

        for i, part in enumerate(parts):
            part_with_space = part if i == len(parts) - 1 else part + " "

            # If adding this part would exceed the limit
            if current_chunk and len(current_chunk + part_with_space) > max_length:
                # Save current chunk (keep trailing space)
                chunks.append(current_chunk)
                current_chunk = part_with_space
            else:
                # Add to current chunk
                current_chunk += part_with_space

            # If a single part is too long, need to force split by words
            if len(current_chunk) > max_length:
                # Remove the part we just added
                if len(current_chunk) > len(part_with_space):
                    current_chunk = current_chunk[:-len(part_with_space)]
                    chunks.append(current_chunk)
                    part_to_split = part_with_space
                else:
                    part_to_split = current_chunk

                # Split by words
                words = part_to_split.strip().split()
                temp_chunk = ""

                for word in words:
                    test_chunk = temp_chunk + " " + word if temp_chunk else word
                    if len(test_chunk) <= max_length:
                        temp_chunk = test_chunk
                    else:
                        if temp_chunk:
                            chunks.append(temp_chunk + " ")
                        temp_chunk = word

                # Keep the last temp_chunk for the next iteration
                current_chunk = temp_chunk + " " if temp_chunk else ""

        # Add remaining chunk
        if current_chunk.strip():
            chunks.append(current_chunk.rstrip())

        return chunks

    def prepare_for_tts(
        self,
        text: str,
        rules: List[PronunciationRule],
        max_length: int
    ) -> Tuple[List[str], TransformationResult]:
        """Prepare text for TTS generation with smart splitting."""
        # Apply rules
        result = self.apply_rules(text, rules, max_length)

        # Split if needed
        if result.would_exceed_limit:
            chunks = self.smart_split(result.transformed_text, max_length)
            logger.info(f"Split text into {len(chunks)} chunks due to length")
        else:
            chunks = [result.transformed_text]

        return chunks, result
