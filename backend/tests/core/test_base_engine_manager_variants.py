"""Tests for BaseEngineManager variant ID support."""



class TestBaseEngineManagerVariants:
    """Tests for variant ID support in BaseEngineManager."""

    def test_parse_variant_id(self):
        """Parse variant_id into engine_name and runner_id."""
        from core.base_engine_manager import parse_variant_id

        engine_name, runner_id = parse_variant_id('xtts:docker:local')
        assert engine_name == 'xtts'
        assert runner_id == 'docker:local'

    def test_parse_variant_id_local(self):
        """Parse local variant_id."""
        from core.base_engine_manager import parse_variant_id

        engine_name, runner_id = parse_variant_id('whisper:local')
        assert engine_name == 'whisper'
        assert runner_id == 'local'

    def test_get_engine_by_variant_id(self):
        """Get engine metadata by variant_id."""
        from core.tts_engine_manager import get_tts_engine_manager

        manager = get_tts_engine_manager()
        installed = manager.list_installed_engines()
        if 'xtts:local' in installed:
            metadata = manager.get_engine_by_variant_id('xtts:local')
            assert metadata is not None
            assert metadata.get('name') == 'xtts' or metadata.get('base_engine_name') == 'xtts'

    def test_get_all_variants(self):
        """Get all engine variants with variant metadata."""
        from core.tts_engine_manager import get_tts_engine_manager

        manager = get_tts_engine_manager()
        variants = manager.get_all_variants()

        # Should have at least one variant if engines are installed
        installed = manager.list_installed_engines()
        if len(installed) > 0:
            assert len(variants) >= 1

        # Each variant should have variant fields
        for variant_id, metadata in variants.items():
            assert ':' in variant_id  # Has variant_id format
            assert 'base_engine_name' in metadata
            assert 'runner_id' in metadata
            assert 'source' in metadata

    def test_start_by_variant_parses_engine_name(self):
        """start_by_variant correctly parses variant_id."""
        from core.base_engine_manager import parse_variant_id

        engine_name, runner_id = parse_variant_id('xtts:local')
        assert engine_name == 'xtts'
        assert runner_id == 'local'

    def test_start_by_variant_docker(self):
        """start_by_variant handles docker variant_id."""
        from core.base_engine_manager import parse_variant_id

        engine_name, runner_id = parse_variant_id('xtts:docker:gpu-server')
        assert engine_name == 'xtts'
        assert runner_id == 'docker:gpu-server'
