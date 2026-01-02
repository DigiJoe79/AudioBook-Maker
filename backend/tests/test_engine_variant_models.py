"""Tests for engine variant models."""

import pytest
from models.engine_variant_models import parse_variant_id, get_host_id_from_variant


class TestEngineVariantId:
    """Tests for EngineVariantId parsing and formatting."""

    def test_parse_local_variant(self):
        """Parse 'xtts:local' correctly."""
        variant = parse_variant_id("xtts:local")
        assert variant.engine_name == "xtts"
        assert variant.runner_id == "local"
        assert variant.runner_type == "subprocess"
        assert variant.runner_host is None

    def test_parse_docker_local_variant(self):
        """Parse 'xtts:docker:local' correctly."""
        variant = parse_variant_id("xtts:docker:local")
        assert variant.engine_name == "xtts"
        assert variant.runner_id == "docker:local"
        assert variant.runner_type == "docker:local"
        assert variant.runner_host == "local"

    def test_parse_docker_remote_variant(self):
        """Parse 'xtts:docker:gpu-server' correctly."""
        variant = parse_variant_id("xtts:docker:gpu-server")
        assert variant.engine_name == "xtts"
        assert variant.runner_id == "docker:gpu-server"
        assert variant.runner_type == "docker:remote"
        assert variant.runner_host == "gpu-server"

    def test_variant_id_string_representation(self):
        """Variant ID converts back to string correctly."""
        variant = parse_variant_id("whisper:docker:local")
        assert str(variant) == "whisper:docker:local"

    def test_invalid_variant_raises(self):
        """Invalid variant ID raises ValueError."""
        with pytest.raises(ValueError):
            parse_variant_id("")

    def test_source_property_local(self):
        """Local variants have source='local'."""
        variant = parse_variant_id("xtts:local")
        assert variant.source == "local"

    def test_source_property_docker(self):
        """Docker variants have source='docker'."""
        variant = parse_variant_id("xtts:docker:local")
        assert variant.source == "docker"


class TestGetHostIdFromVariant:
    """Tests for get_host_id_from_variant helper."""

    def test_subprocess_returns_none(self):
        """Subprocess variants return None (no Docker host)."""
        variant = parse_variant_id("xtts:local")
        assert get_host_id_from_variant(variant) is None

    def test_docker_local_returns_runner_id(self):
        """docker:local returns 'docker:local' as host_id."""
        variant = parse_variant_id("xtts:docker:local")
        assert get_host_id_from_variant(variant) == "docker:local"

    def test_docker_remote_returns_runner_id(self):
        """docker:abc123 returns 'docker:abc123' as host_id."""
        variant = parse_variant_id("xtts:docker:abc123")
        assert get_host_id_from_variant(variant) == "docker:abc123"
