"""API endpoints for pronunciation rules management."""
import sqlite3
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Query, Body
from loguru import logger

from db.database import get_db
from db.pronunciation_repository import PronunciationRulesRepository
from core.pronunciation_transformer import PronunciationTransformer
from models.pronunciation_models import (
    PronunciationRuleCreate,
    PronunciationRuleUpdate,
    PronunciationRule
)
from models.response_models import (
    PronunciationRuleResponse,
    PronunciationRulesListResponse,
    PronunciationTestResponse,
    PronunciationConflictsResponse,
    PronunciationConflict,
    PronunciationBulkResponse,
    PronunciationImportResponse,
    PronunciationTestAudioResponse,
    PronunciationExportRuleResponse,
    MessageResponse
)
from services.event_broadcaster import broadcaster, EventType

router = APIRouter(prefix="/api/pronunciation", tags=["pronunciation"])

def get_pronunciation_repo(db: sqlite3.Connection = Depends(get_db)) -> PronunciationRulesRepository:
    """Get pronunciation repository instance."""
    return PronunciationRulesRepository(db)

@router.post("/rules", response_model=PronunciationRuleResponse, status_code=201)
async def create_rule(
    rule_data: PronunciationRuleCreate,
    repo: PronunciationRulesRepository = Depends(get_pronunciation_repo)
):
    """Create a new pronunciation rule."""
    try:
        rule = repo.create(rule_data)

        # Broadcast SSE event
        await broadcaster.broadcast_pronunciation_update(
            {
                "ruleId": rule.id,
                "pattern": rule.pattern,
                "replacement": rule.replacement,
                "scope": rule.scope,
                "isRegex": rule.is_regex,
                "isActive": rule.is_active,
            },
            event_type=EventType.PRONUNCIATION_RULE_CREATED
        )

        logger.info(f"✓ Pronunciation rule created: {rule.pattern} → {rule.replacement}")

        return PronunciationRuleResponse(
            id=rule.id,
            pattern=rule.pattern,
            replacement=rule.replacement,
            is_regex=rule.is_regex,
            scope=rule.scope,
            project_id=rule.project_id,
            engine_name=rule.engine_name,
            language=rule.language,
            is_active=rule.is_active,
            created_at=rule.created_at.isoformat(),
            updated_at=rule.updated_at.isoformat()
        )

    except Exception as e:
        logger.error(f"Failed to create pronunciation rule: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_RULE_CREATE_FAILED]error:{str(e)}")

@router.get("/rules", response_model=PronunciationRulesListResponse)
async def get_rules(
    engine: Optional[str] = Query(None),
    language: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    scope: Optional[str] = Query(None),
    repo: PronunciationRulesRepository = Depends(get_pronunciation_repo)
):
    """Get pronunciation rules filtered by criteria."""
    try:
        # Get all rules first
        from config import DB_PRONUNCIATION_RULES_LIMIT
        rules = repo.get_all(limit=DB_PRONUNCIATION_RULES_LIMIT)

        # Apply filters client-side (Python filtering)
        filtered_rules = rules

        if engine:
            filtered_rules = [r for r in filtered_rules if r.engine_name == engine]

        if language:
            filtered_rules = [r for r in filtered_rules if r.language == language]

        if project_id:
            filtered_rules = [r for r in filtered_rules if r.project_id == project_id]

        if scope:
            filtered_rules = [r for r in filtered_rules if r.scope == scope]

        return PronunciationRulesListResponse(
            rules=[
                PronunciationRuleResponse(
                    id=rule.id,
                    pattern=rule.pattern,
                    replacement=rule.replacement,
                    is_regex=rule.is_regex,
                    scope=rule.scope,
                    project_id=rule.project_id,
                    engine_name=rule.engine_name,
                    language=rule.language,
                    is_active=rule.is_active,
                    created_at=rule.created_at.isoformat(),
                    updated_at=rule.updated_at.isoformat()
                )
                for rule in filtered_rules
            ],
            total=len(filtered_rules)
        )

    except Exception as e:
        logger.error(f"Failed to get pronunciation rules: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_RULES_GET_FAILED]error:{str(e)}")

@router.put("/rules/{rule_id}", response_model=PronunciationRuleResponse)
async def update_rule(
    rule_id: str,
    update_data: PronunciationRuleUpdate,
    repo: PronunciationRulesRepository = Depends(get_pronunciation_repo)
):
    """Update a pronunciation rule."""
    try:
        rule = repo.update(rule_id, update_data)

        if not rule:
            raise HTTPException(status_code=404, detail=f"[PRONUNCIATION_RULE_NOT_FOUND]ruleId:{rule_id}")

        # Broadcast SSE event
        await broadcaster.broadcast_pronunciation_update(
            {
                "ruleId": rule.id,
                "pattern": rule.pattern,
                "replacement": rule.replacement,
                "scope": rule.scope,
                "isRegex": rule.is_regex,
                "isActive": rule.is_active,
            },
            event_type=EventType.PRONUNCIATION_RULE_UPDATED
        )

        logger.info(f"✓ Pronunciation rule updated: {rule.pattern} → {rule.replacement}")

        return PronunciationRuleResponse(
            id=rule.id,
            pattern=rule.pattern,
            replacement=rule.replacement,
            is_regex=rule.is_regex,
            scope=rule.scope,
            project_id=rule.project_id,
            engine_name=rule.engine_name,
            language=rule.language,
            is_active=rule.is_active,
            created_at=rule.created_at.isoformat(),
            updated_at=rule.updated_at.isoformat()
        )

    except Exception as e:
        logger.error(f"Failed to update pronunciation rule: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_RULE_UPDATE_FAILED]ruleId:{rule_id};error:{str(e)}")

@router.delete("/rules/{rule_id}", response_model=MessageResponse)
async def delete_rule(
    rule_id: str,
    repo: PronunciationRulesRepository = Depends(get_pronunciation_repo)
):
    """Delete a pronunciation rule."""
    try:
        rule = repo.get_by_id(rule_id)
        if not rule:
            raise HTTPException(status_code=404, detail=f"[PRONUNCIATION_RULE_NOT_FOUND]ruleId:{rule_id}")

        success = repo.delete(rule_id)

        if success:
            # Broadcast SSE event
            await broadcaster.broadcast_pronunciation_update(
                {
                    "ruleId": rule_id,
                    "pattern": rule.pattern,  # Include pattern for context
                },
                event_type=EventType.PRONUNCIATION_RULE_DELETED
            )

            logger.info(f"✓ Pronunciation rule deleted: {rule.pattern}")

            return MessageResponse(success=True, message="Rule deleted successfully")
        else:
            raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_DELETE_FAILED]ruleId:{rule_id}")

    except Exception as e:
        logger.error(f"Failed to delete pronunciation rule: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_RULE_DELETE_FAILED]ruleId:{rule_id};error:{str(e)}")

@router.post("/rules/test", response_model=PronunciationTestResponse)
async def test_rules(
    test_data: Dict[str, Any] = Body(...)
):
    """Test pronunciation rules on sample text."""
    try:
        transformer = PronunciationTransformer()

        # Convert dict rules to PronunciationRule objects
        from datetime import datetime
        rules = []
        for rule_dict in test_data.get("rules", []):
            rules.append(PronunciationRule(
                id="test",
                pattern=rule_dict["pattern"],
                replacement=rule_dict["replacement"],
                is_regex=rule_dict.get("isRegex", False),
                scope="global",  # Use valid scope
                engine_name="test",
                language="test",
                is_active=True,
                created_at=datetime.now(),
                updated_at=datetime.now()
            ))

        result = transformer.apply_rules(
            text=test_data["text"],
            rules=rules,
            max_length=test_data.get("maxLength", 250)
        )

        return PronunciationTestResponse(
            original_text=result.original_text,
            transformed_text=result.transformed_text,
            rules_applied=result.rules_applied,
            would_exceed_limit=result.would_exceed_limit,
            chunks_required=result.chunks_required
        )

    except Exception as e:
        logger.error(f"Failed to test pronunciation rules: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_TEST_FAILED]error:{str(e)}")

@router.get("/rules/conflicts", response_model=PronunciationConflictsResponse)
async def get_conflicts(
    engine: str = Query(...),
    language: str = Query(...),
    repo: PronunciationRulesRepository = Depends(get_pronunciation_repo)
):
    """Detect conflicting pronunciation rules."""
    try:
        conflicts = repo.detect_conflicts(engine, language)

        # Format conflicts for response
        conflict_list = []
        for rule1, rule2 in conflicts:
            conflict_list.append(PronunciationConflict(
                rule1={
                    "id": rule1.id,
                    "pattern": rule1.pattern,
                    "scope": rule1.scope
                },
                rule2={
                    "id": rule2.id,
                    "pattern": rule2.pattern,
                    "scope": rule2.scope
                },
                reason="Patterns overlap"
            ))

        return PronunciationConflictsResponse(
            conflicts=conflict_list,
            total=len(conflict_list)
        )

    except Exception as e:
        logger.error(f"Failed to detect conflicts: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_CONFLICTS_FAILED]engine:{engine};language:{language};error:{str(e)}")

@router.post("/rules/bulk", response_model=PronunciationBulkResponse)
async def bulk_operations(
    bulk_data: Dict[str, Any] = Body(...),
    repo: PronunciationRulesRepository = Depends(get_pronunciation_repo)
):
    """Perform bulk operations on pronunciation rules."""
    try:
        rule_ids = bulk_data.get("ruleIds", [])
        action = bulk_data.get("action")

        modified_count = 0

        if action == "move":
            target_scope = bulk_data.get("targetScope")
            for rule_id in rule_ids:
                rule = repo.update(
                    rule_id,
                    PronunciationRuleUpdate(scope=target_scope)
                )
                if rule:
                    modified_count += 1

        elif action == "toggle":
            is_active = bulk_data.get("isActive", True)
            for rule_id in rule_ids:
                rule = repo.update(
                    rule_id,
                    PronunciationRuleUpdate(is_active=is_active)
                )
                if rule:
                    modified_count += 1

        elif action == "delete":
            for rule_id in rule_ids:
                if repo.delete(rule_id):
                    modified_count += 1

        # Broadcast bulk change event
        await broadcaster.broadcast_event(
            event_type=EventType.PRONUNCIATION_RULE_BULK_CHANGE,
            data={
                "action": action,
                "count": modified_count,
                "targetScope": bulk_data.get("targetScope")
            },
            channel="settings"
        )

        return PronunciationBulkResponse(
            message="Bulk operation completed",
            modified=modified_count
        )

    except Exception as e:
        logger.error(f"Failed to perform bulk operation: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_BULK_OPERATION_FAILED]action:{bulk_data.get('action', 'unknown')};error:{str(e)}")


@router.get("/rules/export", response_model=List[PronunciationExportRuleResponse])
async def export_rules(
    rule_ids: Optional[List[str]] = Query(None),
    engine: Optional[str] = Query(None),
    language: Optional[str] = Query(None),
    repo: PronunciationRulesRepository = Depends(get_pronunciation_repo)
) -> List[PronunciationExportRuleResponse]:
    """Export pronunciation rules as JSON.

    Args:
        rule_ids: Optional list of specific rule IDs to export
        engine: Optional engine filter
        language: Optional language filter

    Returns:
        JSON array of rules
    """
    try:
        if rule_ids:
            # Export specific rules
            rules = [repo.get_by_id(rule_id) for rule_id in rule_ids]
            rules = [r for r in rules if r is not None]
        else:
            # Export with filters
            if engine and language:
                rules = repo.get_rules_for_context(engine, language)
            else:
                # Get all rules
                rules = repo.get_all()

        # Convert to response models (auto-converts to camelCase)
        export_data = [
            PronunciationExportRuleResponse(
                pattern=rule.pattern,
                replacement=rule.replacement,
                is_regex=rule.is_regex,
                scope=rule.scope,
                project_id=rule.project_id,
                engine_name=rule.engine_name,
                language=rule.language,
                is_active=rule.is_active,
                created_at=rule.created_at.isoformat(),
                updated_at=rule.updated_at.isoformat()
            )
            for rule in rules
        ]

        logger.info(f"Exported {len(export_data)} pronunciation rules")

        return export_data

    except Exception as e:
        logger.error(f"Failed to export rules: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_RULES_EXPORT_FAILED]error:{str(e)}")


@router.post("/rules/import", response_model=PronunciationImportResponse)
async def import_rules(
    import_data: Dict[str, Any] = Body(...),
    repo: PronunciationRulesRepository = Depends(get_pronunciation_repo)
):
    """Import pronunciation rules from JSON.

    Args:
        import_data: Dict with 'rules' array and 'mode' ('merge' or 'replace')

    Returns:
        Import statistics
    """
    try:
        rules = import_data.get("rules", [])
        mode = import_data.get("mode", "merge")

        if mode == "replace":
            # Delete existing rules (be careful!)
            # For safety, only delete rules that match imported scope/engine/language
            pass  # Implement if needed

        imported_count = 0
        skipped_count = 0

        for rule_data in rules:
            try:
                # Create rule
                rule_create = PronunciationRuleCreate(
                    pattern=rule_data["pattern"],
                    replacement=rule_data["replacement"],
                    is_regex=rule_data.get("isRegex", False),
                    scope=rule_data["scope"],
                    project_id=rule_data.get("projectId"),
                    engine_name=rule_data["engineName"],
                    language=rule_data["language"],
                    is_active=rule_data.get("isActive", True)
                )

                repo.create(rule_create)
                imported_count += 1

            except Exception as e:
                logger.warning(f"Skipped rule {rule_data.get('pattern')}: {e}")
                skipped_count += 1
                continue

        # Broadcast event
        await broadcaster.broadcast_event(
            event_type=EventType.PRONUNCIATION_RULES_IMPORTED,
            data={
                "imported": imported_count,
                "skipped": skipped_count,
                "mode": mode
            },
            channel="settings"
        )

        logger.info(f"Imported {imported_count} rules, skipped {skipped_count}")

        return PronunciationImportResponse(
            success=True,
            imported=imported_count,
            skipped=skipped_count,
            message=f"Successfully imported {imported_count} rules"
        )

    except Exception as e:
        logger.error(f"Failed to import rules: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_RULES_IMPORT_FAILED]error:{str(e)}")


@router.post("/rules/test-audio", response_model=PronunciationTestAudioResponse)
async def generate_test_audio(
    test_data: Dict[str, Any] = Body(...),
    db: sqlite3.Connection = Depends(get_db)
) -> PronunciationTestAudioResponse:
    """Generate test audio with pronunciation rule applied.

    Args:
        test_data: Dict with 'segmentId' and 'rule' to test

    Returns:
        Audio path and metadata
    """
    try:
        segment_id = test_data.get("segmentId")
        rule_data = test_data.get("rule")

        if not segment_id or not rule_data:
            raise HTTPException(
                status_code=400,
                detail="[PRONUNCIATION_MISSING_PARAMS]"
            )

        # Get segment
        from db.repositories import SegmentRepository
        segment_repo = SegmentRepository(db)
        segment = segment_repo.get_by_id(segment_id)

        if not segment:
            raise HTTPException(status_code=404, detail=f"[PRONUNCIATION_SEGMENT_NOT_FOUND]segmentId:{segment_id}")

        # Create temporary rule
        from datetime import datetime
        test_rule = PronunciationRule(
            id="test",
            pattern=rule_data["pattern"],
            replacement=rule_data["replacement"],
            is_regex=rule_data.get("isRegex", False),
            scope="test",
            engine_name=segment['tts_engine'],
            language=segment['language'],
            is_active=True,
            created_at=datetime.now(),
            updated_at=datetime.now()
        )

        # Apply transformation
        transformer = PronunciationTransformer()
        result = transformer.apply_rules(
            text=segment['text'],
            rules=[test_rule]
        )

        # Generate audio with transformed text
        # This would need to call the TTS engine directly
        # For now, return the transformation info

        # TODO: Integrate with engine manager to generate actual audio

        return PronunciationTestAudioResponse(
            original_text=segment['text'],
            transformed_text=result.transformed_text,
            rules_applied=result.rules_applied,
            audio_path=None,
            message="Test transformation complete (audio generation not yet implemented)"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate test audio: {e}")
        raise HTTPException(status_code=500, detail=f"[PRONUNCIATION_TEST_AUDIO_FAILED]error:{str(e)}")
