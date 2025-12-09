# Release v1.0.1 - Bug Fixes

Patch release with bug fixes and stability improvements.

## Bug Fixes

- **Speaker sample paths**: Changed from absolute to relative paths for portability. Existing speakers need to be re-added.
- **Speaker preview player**: Fixed play/pause icon state sync
- **Windows server shutdown**: Suppressed harmless `ConnectionResetError` on Ctrl+C
- **E2E tests**: Made segment tests locale-agnostic (work in German and English)

## Migration

**Existing users with speaker samples** must re-add their speakers after updating (delete and re-create).

---

**Full Changelog**: https://github.com/user/audiobook-maker/compare/v1.0.0...v1.0.1
