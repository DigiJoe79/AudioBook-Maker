# 09-Audio-Export Test Specification

## Prerequisites

- 07-tts-workflow must pass (Kapitel 1 & 2 have audio)
- Testprojekt with completed audio segments exists

## Test Data-TestIDs

| Element | data-testid |
|---------|-------------|
| Export Button | `export-chapter-button` |
| Export Dialog | `export-dialog` |
| Filename Input | `export-filename-input` |
| Format Select | `export-format-select` |
| Format Options | `export-format-mp3`, `export-format-m4a`, `export-format-wav` |
| Quality Select | `export-quality-select` |
| Quality Options | `export-quality-low`, `export-quality-medium`, `export-quality-high` |
| Start Button | `export-start-button` |
| Cancel Button | `export-cancel-button` |
| Download Button | `export-download-button` |
| Close Button | `export-close-button` |
| Progress Container | `export-progress-container` |
| Progress Bar | `export-progress-bar` |
| Progress Message | `export-progress-message` |
| Progress Detail | `export-progress-detail` |

## Tests

### 1. should have export button disabled without completed audio
- Navigate to chapter
- Check if export button is visible
- Verify disabled state when segments incomplete

### 2. should open export dialog when segments are completed
- Navigate to chapter with completed segments
- Click export button
- Verify dialog opens
- Close dialog

### 3. should show export options in dialog
- Open export dialog
- Verify filename input visible
- Verify format select visible
- Verify quality select visible
- Verify start button enabled

### 4. should allow changing export format
- Open export dialog
- Select MP3 format
- Verify selection
- Select WAV format
- Verify selection

### 5. should allow changing quality preset
- Open export dialog
- Select high quality
- Select low quality

### 6. should start export and show progress
- Open export dialog
- Click start export
- Wait for progress container
- Wait for completion
- Verify download button appears

### 7. should be able to cancel export in progress
- Start export
- Click cancel button (if visible before completion)
- Verify dialog resets or closes

### 8. CHECKPOINT: Export workflow complete
- Verify export button is visible and enabled
- Confirms segments have completed audio

## SSE Events

Export uses SSE for progress updates:
- `export_progress` - Progress updates during merge/convert
- `export_complete` - Export finished successfully
- `export_failed` - Export failed with error

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/audio/export` | Start export job |
| `GET /api/audio/export/{id}/progress` | Get progress |
| `DELETE /api/audio/export/{id}/cancel` | Cancel export |
| `GET /api/audio/export/{id}/download` | Get download URL |
| `DELETE /api/audio/export/{id}` | Cleanup export file |
