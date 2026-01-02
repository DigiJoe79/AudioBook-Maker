# E2E Test: Engine Variants UI

## Overview
Tests for the grouped engine variant display in EnginesView.

## Test Cases

### 1. TTS Variant Groups Display
- Navigate to Monitoring > Engines tab
- Verify TTS section shows grouped variants
- Verify "Local Engines" group is visible
- Verify engines are listed within groups

### 2. Variant Group Expand/Collapse
- Click on group header to collapse
- Verify engines are hidden
- Click again to expand
- Verify engines are visible

### 3. Engine Actions in Variant List
- Verify Start button is visible for stopped engines
- Verify Stop button is visible for running engines
- Verify Settings button is always visible

## Prerequisites
- Backend must be running
- At least one TTS engine must be available
