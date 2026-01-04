# Release v1.1.2 - Unified Error Handling

This release addresses some minor fixes and improving maintainability and consistency of error responses for frontend i18n translation.

## What's New

### Unified ApplicationError Exception

All backend errors now use a single `ApplicationError` class instead of 20+ specialized exception subclasses.

### Error Format

All errors follow the i18n-compatible format:
```
[ERROR_CODE]param1:value1;param2:value2
```

## Bug Fixes

### Frontend Error Message Parsing

**Problem:** Error messages containing colons in parameter values were incorrectly parsed, causing i18n translation failures.

**Example:**
```
[ENGINE_START_FAILED]error:Engine spacy:docker:local failed
```

The previous parser split on all colons, resulting in:
- `error` → `Engine spacy` (truncated)

**Fix:** Split only on the first colon to preserve colons in values:
- `error` → `Engine spacy:docker:local failed` (complete)

**Affected file:** `frontend/src/utils/translateBackendError.ts`

### Docker Image Update Cleanup Failure

**Problem:** When updating a Docker engine image, the cleanup of the old (dangling) image failed with error:
```
409 Conflict: unable to delete image - image is being used by running container
```

**Cause:** The update flow attempted to remove the old image while the container was still running.

**Fix:** Stop the running engine container before attempting to remove the old dangling image.

**Affected file:** `backend/api/engines.py`

## Upgrade Notes

- **No database migration required**

---

**Full Changelog**: https://github.com/DigiJoe79/audiobook-maker/compare/v1.1.1...v1.1.2
