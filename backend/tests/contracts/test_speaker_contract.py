"""
Contract Tests for Speaker Endpoints
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from models.response_models import SpeakerResponse, DeleteResponse


client = TestClient(app)


@pytest.fixture
def test_speaker():
    """Create and cleanup test speaker."""
    response = client.post("/api/speakers/", json={
        "name": "Contract Test Speaker",
        "description": "For testing",
        "languages": ["de", "en"],
        "tags": ["test"]
    })
    assert response.status_code == 200
    speaker = response.json()
    yield speaker
    client.delete(f"/api/speakers/{speaker['id']}")


class TestSpeakerListContract:
    """Contract tests for GET /speakers."""

    def test_list_speakers_returns_200(self):
        response = client.get("/api/speakers/")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_list_speakers_items_validate_schema(self, test_speaker):
        response = client.get("/api/speakers/")
        speakers = response.json()
        for s in speakers:
            SpeakerResponse.model_validate(s)


class TestSpeakerGetContract:
    """Contract tests for GET /speakers/{id}."""

    def test_get_speaker_returns_200(self, test_speaker):
        response = client.get(f"/api/speakers/{test_speaker['id']}")
        assert response.status_code == 200

    def test_get_speaker_validates_schema(self, test_speaker):
        response = client.get(f"/api/speakers/{test_speaker['id']}")
        validated = SpeakerResponse.model_validate(response.json())
        assert validated.name == "Contract Test Speaker"

    def test_get_speaker_uses_camel_case(self, test_speaker):
        data = client.get(f"/api/speakers/{test_speaker['id']}").json()
        assert "isActive" in data
        assert "isDefault" in data
        assert "createdAt" in data
        assert "is_active" not in data

    def test_get_speaker_returns_404_for_unknown(self):
        response = client.get("/api/speakers/nonexistent-id")
        assert response.status_code == 404


class TestSpeakerCreateContract:
    """Contract tests for POST /speakers."""

    def test_create_speaker_returns_speaker_response(self):
        response = client.post("/api/speakers/", json={
            "name": "New Speaker",
            "languages": ["de"]
        })
        assert response.status_code == 200
        validated = SpeakerResponse.model_validate(response.json())
        assert validated.name == "New Speaker"
        client.delete(f"/api/speakers/{response.json()['id']}")


class TestSpeakerDeleteContract:
    """Contract tests for DELETE /speakers/{id}."""

    def test_delete_speaker_returns_delete_response(self):
        create_resp = client.post("/api/speakers/", json={
            "name": "To Delete",
            "languages": ["de"]
        })
        speaker_id = create_resp.json()["id"]

        response = client.delete(f"/api/speakers/{speaker_id}")
        assert response.status_code == 200
        DeleteResponse.model_validate(response.json())
