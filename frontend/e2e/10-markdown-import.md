# 10-Markdown-Import Test Specification

## Prerequisites

- Backend running with text processing engine (spaCy) available
- At least one TTS engine configured
- Speaker(s) created in the speakers view

## Test Data-TestIDs

| Element | data-testid |
|---------|-------------|
| Import View | `import-view` |
| Execute Button | `import-execute-button` |
| Config Panel | `import-config-panel` |
| Preview Panel | `import-preview-panel` |

### File Upload Section

| Element | data-testid |
|---------|-------------|
| File Upload Section | `import-file-upload-section` |
| Text Language Selector | `text-language-selector` |
| File Upload Area | `file-upload-area` |
| Upload Zone | `upload-zone` |
| Selected File Info | `selected-file-info` |
| Remove File Button | `remove-file-button` |
| File Input | `file-input` |
| Upload Error | `upload-error` |

### Mapping Rules Section

| Element | data-testid |
|---------|-------------|
| Mapping Section | `import-mapping-section` |
| Mapping Rules Editor | `mapping-rules-editor` |
| Reset Button | `reset-button` |
| Project Heading Select | `project-heading-select` |
| Chapter Heading Select | `chapter-heading-select` |
| Divider Pattern Select | `divider-pattern-select` |

### Import Mode Section

| Element | data-testid |
|---------|-------------|
| Mode Section | `import-mode-section` |
| Mode Selector | `import-mode-selector` |
| Mode Radio Group | `import-mode-radio-group` |
| New Project Radio | `mode-new-radio` |
| Merge Radio | `mode-merge-radio` |
| Merge Target Select | `merge-target-select` |

### TTS Settings Section

| Element | data-testid |
|---------|-------------|
| TTS Section | `import-tts-section` |
| TTS Settings Selector | `tts-settings-selector` |
| Engine Select | `tts-engine-select` |
| Model Select | `tts-model-select` |
| Speaker Select | `tts-speaker-select` |
| Language Select | `tts-language-select` |

### Preview Panel

| Element | data-testid |
|---------|-------------|
| Preview Loading | `import-preview-loading` |
| Preview Empty | `import-preview-empty` |
| Preview Content | `import-preview-content` |
| Project Info | `import-preview-project-info` |
| Statistics | `import-preview-statistics` |
| Warnings | `import-preview-warnings` |
| Chapters | `import-preview-chapters` |
| Chapter Item | `import-preview-chapter-{id}` |
| Importing Overlay | `import-preview-importing` |

## Tests

### 1. should navigate to Import view

- Click Import navigation item
- Verify Import view is visible
- Verify config panel and preview panel are visible

### 2. should show empty preview when no file selected

- Navigate to Import view
- Verify empty preview state is visible
- Verify file upload section is expanded

### 3. should show text language selector

- Navigate to Import view
- Verify text language selector is visible
- Verify language options are available

### 4. should show upload zone when no file selected

- Navigate to Import view
- Verify upload zone is visible
- Verify upload zone is clickable

### 5. should show mapping rules section

- Navigate to Import view
- Expand mapping section
- Verify mapping rules editor is visible
- Verify project heading selector is visible
- Verify chapter heading selector is visible
- Verify divider pattern selector is visible

### 6. should allow changing mapping rules

- Expand mapping section
- Change project heading to ##
- Verify selection changed
- Change chapter heading to ###
- Verify selection changed

### 7. should have reset button for mapping rules

- Expand mapping section
- Verify reset button is visible
- Click reset button (if rules were changed)

### 8. should show import mode section when preview is valid

- Upload valid markdown file (requires spaCy)
- Verify mode section appears
- Verify new project mode is selected by default

### 9. should show merge target when merge mode selected

- Select merge mode
- Verify merge target dropdown appears
- Verify projects are listed

### 10. should show TTS settings section when preview is valid

- Upload valid markdown file (requires spaCy)
- Verify TTS section appears
- Verify engine selector is visible
- Verify model selector is visible
- Verify language selector is visible

### 11. should show preview content when file is parsed

- Upload valid markdown file (requires spaCy)
- Verify preview content is visible
- Verify project info is shown
- Verify statistics are shown
- Verify chapters list is shown

### 12. should show import button disabled without valid configuration

- Navigate to Import view (no file)
- Verify import button is disabled
- Verify button becomes enabled with valid configuration

### 13. CHECKPOINT: Import view accessible

- Navigate to Import view
- Verify all main sections are visible
- Confirms import feature is working

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/projects/import/preview` | Parse markdown and get preview |
| `POST /api/projects/import` | Execute import |
| `GET /api/projects` | List projects for merge mode |
| `GET /api/engines/status` | Get available TTS engines |
| `GET /api/speakers` | Get available speakers |

## Notes

- Many tests require spaCy text processing engine to be running
- Preview is debounced (500ms) after file upload
- Import mode section only appears after valid preview
- TTS section only appears after valid preview
- File validation happens client-side (format, size)
