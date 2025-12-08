"""
Contract Tests for Chapter Endpoints
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from models.response_models import ChapterResponse, DeleteResponse


client = TestClient(app)


@pytest.fixture
def test_project():
    """Create a test project."""
    response = client.post("/api/projects", json={
        "title": "Chapter Contract Test Project",
        "description": "For testing"
    })
    assert response.status_code == 200
    project = response.json()
    yield project
    client.delete(f"/api/projects/{project['id']}")


@pytest.fixture
def test_chapter(test_project):
    """Create a test chapter."""
    response = client.post("/api/chapters", json={
        "projectId": test_project["id"],
        "title": "Test Chapter",
        "orderIndex": 0
    })
    assert response.status_code == 200
    yield response.json()


class TestChapterGetContract:
    """Contract tests for GET /chapters/{id}."""

    def test_get_chapter_returns_200(self, test_chapter):
        response = client.get(f"/api/chapters/{test_chapter['id']}")
        assert response.status_code == 200

    def test_get_chapter_validates_schema(self, test_chapter):
        response = client.get(f"/api/chapters/{test_chapter['id']}")
        validated = ChapterResponse.model_validate(response.json())
        assert validated.title == "Test Chapter"

    def test_get_chapter_uses_camel_case(self, test_chapter):
        data = client.get(f"/api/chapters/{test_chapter['id']}").json()
        assert "projectId" in data
        assert "orderIndex" in data
        assert "createdAt" in data
        assert "project_id" not in data

    def test_get_chapter_returns_404_for_unknown(self):
        response = client.get("/api/chapters/nonexistent-id")
        assert response.status_code == 404


class TestChapterCreateContract:
    """Contract tests for POST /chapters."""

    def test_create_chapter_returns_chapter_response(self, test_project):
        response = client.post("/api/chapters", json={
            "projectId": test_project["id"],
            "title": "New Chapter",
            "orderIndex": 1
        })
        assert response.status_code == 200
        validated = ChapterResponse.model_validate(response.json())
        assert validated.title == "New Chapter"
        client.delete(f"/api/chapters/{response.json()['id']}")


class TestChapterDeleteContract:
    """Contract tests for DELETE /chapters/{id}."""

    def test_delete_chapter_returns_delete_response(self, test_project):
        create_resp = client.post("/api/chapters", json={
            "projectId": test_project["id"],
            "title": "To Delete",
            "orderIndex": 0
        })
        chapter_id = create_resp.json()["id"]

        response = client.delete(f"/api/chapters/{chapter_id}")
        assert response.status_code == 200
        DeleteResponse.model_validate(response.json())

    def test_delete_unknown_returns_404(self):
        response = client.delete("/api/chapters/nonexistent-id")
        assert response.status_code == 404
