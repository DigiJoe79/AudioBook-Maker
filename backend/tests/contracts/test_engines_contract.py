"""
Contract Tests for Engines Endpoints
"""

from fastapi.testclient import TestClient
from main import app
from models.response_models import AllEnginesStatusResponse


client = TestClient(app)


class TestEnginesStatusContract:
    """Contract tests for GET /api/engines/status."""

    def test_engines_status_returns_200(self):
        response = client.get("/api/engines/status")
        assert response.status_code == 200

    def test_engines_status_validates_schema(self):
        response = client.get("/api/engines/status")
        validated = AllEnginesStatusResponse.model_validate(response.json())

        # Should have engine type categories
        assert hasattr(validated, 'tts')
        assert hasattr(validated, 'stt')
        assert hasattr(validated, 'text')
        assert hasattr(validated, 'audio')

    def test_engines_status_uses_camel_case(self):
        data = client.get("/api/engines/status").json()

        # Top-level keys
        assert "tts" in data
        assert "stt" in data

        # Check engine info structure - can be list or dict
        for engine_type in ["tts", "stt", "text", "audio"]:
            engines = data.get(engine_type, [])
            if isinstance(engines, list):
                for info in engines:
                    assert "is_default" not in info
                    assert "last_activity" not in info
            elif isinstance(engines, dict):
                for engine_name, info in engines.items():
                    assert "is_default" not in info
                    assert "last_activity" not in info


class TestEnginesTypesContract:
    """Contract tests for engine type endpoints."""

    def test_tts_engines_endpoint_exists(self):
        # This might return empty if no TTS engines configured
        response = client.get("/api/engines/status")
        assert response.status_code == 200
        assert "tts" in response.json()

    def test_stt_engines_in_status(self):
        response = client.get("/api/engines/status")
        assert response.status_code == 200
        assert "stt" in response.json()

    def test_text_engines_in_status(self):
        response = client.get("/api/engines/status")
        assert response.status_code == 200
        assert "text" in response.json()

    def test_audio_engines_in_status(self):
        response = client.get("/api/engines/status")
        assert response.status_code == 200
        assert "audio" in response.json()
