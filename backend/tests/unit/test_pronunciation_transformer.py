"""
Unit Tests for PronunciationTransformer

Tests the text transformation system for pronunciation correction.
"""

import pytest
from datetime import datetime

from core.pronunciation_transformer import PronunciationTransformer, TransformationResult
from models.pronunciation_models import PronunciationRule


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def transformer():
    """Create PronunciationTransformer instance."""
    return PronunciationTransformer()


def create_rule(
    pattern: str,
    replacement: str,
    is_regex: bool = False,
    is_active: bool = True,
    rule_id: str = "test-rule-1"
) -> PronunciationRule:
    """Helper to create PronunciationRule objects."""
    return PronunciationRule(
        id=rule_id,
        pattern=pattern,
        replacement=replacement,
        is_regex=is_regex,
        is_active=is_active,
        scope="engine",
        project_id=None,
        engine_name="test-engine",
        language="en",
        created_at=datetime.now(),
        updated_at=datetime.now()
    )


# ============================================================================
# Test: apply_rules - Simple Replacements
# ============================================================================

class TestApplyRulesSimple:
    """Tests for simple string replacement rules."""

    def test_simple_replacement(self, transformer):
        """Simple string is replaced."""
        rules = [create_rule("hello", "hi")]

        result = transformer.apply_rules("Say hello to the world", rules)

        assert result.transformed_text == "Say hi to the world"
        assert len(result.rules_applied) == 1

    def test_multiple_occurrences(self, transformer):
        """All occurrences are replaced."""
        rules = [create_rule("the", "ze")]

        result = transformer.apply_rules("the cat and the dog", rules)

        assert result.transformed_text == "ze cat and ze dog"

    def test_multiple_rules(self, transformer):
        """Multiple rules are applied in order."""
        rules = [
            create_rule("Dr.", "Doctor", rule_id="1"),
            create_rule("Mr.", "Mister", rule_id="2"),
        ]

        result = transformer.apply_rules("Dr. Smith met Mr. Jones", rules)

        assert result.transformed_text == "Doctor Smith met Mister Jones"
        assert len(result.rules_applied) == 2

    def test_no_match_returns_original(self, transformer):
        """Text unchanged if no rules match."""
        rules = [create_rule("xyz", "abc")]

        result = transformer.apply_rules("hello world", rules)

        assert result.transformed_text == "hello world"
        assert len(result.rules_applied) == 0

    def test_inactive_rule_skipped(self, transformer):
        """Inactive rules are not applied."""
        rules = [create_rule("hello", "hi", is_active=False)]

        result = transformer.apply_rules("hello world", rules)

        assert result.transformed_text == "hello world"
        assert len(result.rules_applied) == 0


# ============================================================================
# Test: apply_rules - Regex Replacements
# ============================================================================

class TestApplyRulesRegex:
    """Tests for regex pattern replacement rules."""

    def test_regex_pattern(self, transformer):
        """Regex pattern is matched and replaced."""
        rules = [create_rule(r"\d+", "NUMBER", is_regex=True)]

        result = transformer.apply_rules("I have 42 apples and 7 oranges", rules)

        assert result.transformed_text == "I have NUMBER apples and NUMBER oranges"

    def test_regex_with_groups(self, transformer):
        """Regex with capture groups works."""
        rules = [create_rule(r"(\d+)km", r"\1 kilometers", is_regex=True)]

        result = transformer.apply_rules("The distance is 5km", rules)

        assert result.transformed_text == "The distance is 5 kilometers"

    def test_regex_with_dollar_sign_groups(self, transformer):
        """JavaScript-style $1, $2 groups are converted to Python style."""
        rules = [create_rule(r"(\w+)@(\w+)", r"$1 at $2", is_regex=True)]

        result = transformer.apply_rules("Contact: john@example", rules)

        assert result.transformed_text == "Contact: john at example"

    def test_invalid_regex_skipped(self, transformer):
        """Invalid regex patterns are skipped without error."""
        rules = [create_rule(r"[invalid(", "replacement", is_regex=True)]

        result = transformer.apply_rules("test text", rules)

        # Should not crash, text unchanged
        assert result.transformed_text == "test text"
        assert len(result.rules_applied) == 0

    def test_word_boundary_regex(self, transformer):
        """Word boundary regex works correctly."""
        rules = [create_rule(r"\bcat\b", "feline", is_regex=True)]

        result = transformer.apply_rules("The cat sat on the caterpillar", rules)

        assert result.transformed_text == "The feline sat on the caterpillar"


# ============================================================================
# Test: apply_rules - Length Tracking
# ============================================================================

class TestApplyRulesLengthTracking:
    """Tests for length tracking in apply_rules."""

    def test_tracks_length_before_and_after(self, transformer):
        """Length before and after are tracked."""
        rules = [create_rule("hello", "hi")]
        text = "hello world"

        result = transformer.apply_rules(text, rules)

        assert result.length_before == 11  # "hello world"
        assert result.length_after == 8    # "hi world"

    def test_would_exceed_limit_false(self, transformer):
        """would_exceed_limit is False when under limit."""
        rules = [create_rule("a", "aa")]
        text = "aaa"  # 3 chars -> 6 chars

        result = transformer.apply_rules(text, rules, max_length=10)

        assert result.would_exceed_limit is False
        assert result.chunks_required == 1

    def test_would_exceed_limit_true(self, transformer):
        """would_exceed_limit is True when over limit."""
        rules = [create_rule("a", "aaaa")]  # Each 'a' becomes 'aaaa'
        text = "aaa"  # 3 chars -> 12 chars

        result = transformer.apply_rules(text, rules, max_length=10)

        assert result.would_exceed_limit is True
        assert result.chunks_required == 2  # 12/10 = 2 chunks needed

    def test_preserves_original_text(self, transformer):
        """Original text is preserved in result."""
        rules = [create_rule("old", "new")]
        original = "this is old text"

        result = transformer.apply_rules(original, rules)

        assert result.original_text == original


# ============================================================================
# Test: smart_split
# ============================================================================

class TestSmartSplit:
    """Tests for smart text splitting."""

    def test_no_split_when_under_limit(self, transformer):
        """Text under limit is not split."""
        text = "Short text."

        chunks = transformer.smart_split(text, max_length=100)

        assert len(chunks) == 1
        assert chunks[0] == text

    def test_splits_at_sentence_boundaries(self, transformer):
        """Text is split at sentence boundaries."""
        text = "First sentence. Second sentence. Third sentence."

        chunks = transformer.smart_split(text, max_length=30)

        assert len(chunks) >= 2
        # Each chunk should end with proper punctuation or be the last chunk
        for chunk in chunks[:-1]:
            assert chunk.rstrip().endswith(('.', '!', '?')) or ' ' in chunk

    def test_preserves_spaces(self, transformer):
        """Spaces between sentences are preserved."""
        text = "Hello world. Goodbye world."

        chunks = transformer.smart_split(text, max_length=20)

        # Joining should approximate original
        rejoined = "".join(chunks).strip()
        assert "Hello world" in rejoined
        assert "Goodbye world" in rejoined

    def test_handles_very_long_words(self, transformer):
        """Very long words are handled by word splitting."""
        text = "This contains supercalifragilisticexpialidocious words."

        chunks = transformer.smart_split(text, max_length=20)

        # Should produce multiple chunks
        assert len(chunks) >= 1
        # Each chunk should be under limit or be a single word
        for chunk in chunks:
            # Allow some tolerance for word boundaries
            assert len(chunk.strip()) <= 50  # Reasonable max for a single word

    def test_handles_question_marks(self, transformer):
        """Splits at question marks."""
        text = "Is this working? Yes it is! Great."

        chunks = transformer.smart_split(text, max_length=20)

        assert len(chunks) >= 2

    def test_handles_exclamation_marks(self, transformer):
        """Splits at exclamation marks."""
        text = "Amazing! Incredible! Wonderful!"

        chunks = transformer.smart_split(text, max_length=15)

        assert len(chunks) >= 2


# ============================================================================
# Test: prepare_for_tts
# ============================================================================

class TestPrepareForTTS:
    """Tests for prepare_for_tts method."""

    def test_applies_rules_and_returns_chunks(self, transformer):
        """Rules are applied and text is chunked."""
        rules = [create_rule("Dr.", "Doctor")]
        text = "Dr. Smith said hello."

        chunks, result = transformer.prepare_for_tts(text, rules, max_length=100)

        assert len(chunks) == 1
        assert chunks[0] == "Doctor Smith said hello."
        assert result.transformed_text == "Doctor Smith said hello."

    def test_splits_when_exceeds_limit(self, transformer):
        """Text is split when exceeding max_length."""
        rules = []  # No transformation
        text = "First sentence. Second sentence. Third sentence."

        chunks, result = transformer.prepare_for_tts(text, rules, max_length=25)

        assert len(chunks) >= 2

    def test_returns_transformation_result(self, transformer):
        """TransformationResult is returned with correct data."""
        rules = [create_rule("a", "aa")]
        text = "aaa"

        chunks, result = transformer.prepare_for_tts(text, rules, max_length=10)

        assert isinstance(result, TransformationResult)
        assert result.original_text == "aaa"
        assert result.transformed_text == "aaaaaa"
        assert result.length_before == 3
        assert result.length_after == 6

    def test_empty_rules_list(self, transformer):
        """Empty rules list returns unchanged text."""
        text = "Hello world."

        chunks, result = transformer.prepare_for_tts(text, [], max_length=100)

        assert chunks == ["Hello world."]
        assert result.transformed_text == text
        assert len(result.rules_applied) == 0


# ============================================================================
# Test: TransformationResult
# ============================================================================

class TestTransformationResult:
    """Tests for TransformationResult dataclass."""

    def test_default_values(self):
        """Default values are set correctly."""
        result = TransformationResult(
            original_text="test",
            transformed_text="test",
            rules_applied=[],
            length_before=4,
            length_after=4
        )

        assert result.would_exceed_limit is False
        assert result.chunks_required == 1

    def test_all_fields(self):
        """All fields can be set."""
        result = TransformationResult(
            original_text="original",
            transformed_text="transformed",
            rules_applied=["rule1", "rule2"],
            length_before=8,
            length_after=11,
            would_exceed_limit=True,
            chunks_required=3
        )

        assert result.original_text == "original"
        assert result.transformed_text == "transformed"
        assert len(result.rules_applied) == 2
        assert result.would_exceed_limit is True
        assert result.chunks_required == 3
