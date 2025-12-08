# 06-Segment Tests

**Datei:** `tests/06-segment.spec.ts`
**Voraussetzung:** 05-text-upload muss bestanden sein (Kapitel 1 hat Segmente)
**Laufzeit:** ~25s

## Übersicht

Echte E2E-Tests für Segment-Management. Testet Drag & Drop-Erstellung, CRUD-Operationen und SSE-Updates.

**Test-IDs verwendet:**
- `segment-list` - Virtualisierte Segment-Liste
- `create-segment-button` - "Text Segment" Chip (draggable)
- `create-divider-button` - "Pause" Chip (draggable)
- `quick-create-segment-dialog` - Quick Create Segment Dialog
- `quick-create-segment-text-input` - Text Eingabefeld
- `quick-create-segment-submit` - Create Button
- `quick-create-divider-dialog` - Quick Create Divider Dialog
- `quick-create-divider-submit` - Add Pause Button
- `segment-menu-button` - Menü Button auf Segment
- `segment-menu-edit` - "Text bearbeiten" im Menü
- `segment-menu-settings` - "Einstellungen" im Menü
- `segment-menu-delete` - "Löschen" im Menü
- `edit-segment-dialog` - Edit Segment Text Dialog
- `edit-segment-text-editor` - Text Editor
- `edit-segment-save-button` - Save Button
- `segment-settings-dialog` - Segment Settings Dialog
- `segment-settings-speaker-select` - Speaker Dropdown
- `confirm-dialog` - Bestätigungsdialog
- `confirm-dialog-confirm` - Bestätigen Button

---

## Setup: beforeEach

**Schritte (vor jedem Test):**
1. URL prüfen - falls nicht auf `/app`:
   - "Verbinden/Connect" Button finden und klicken
   - Warten auf URL `**/app`
2. Prüfung: `app-layout` ist sichtbar
3. Klick auf `nav-main`
4. Prüfung: `main-view` ist sichtbar

---

## Drag & Drop Helper

**Funktion:** `dndKitDragToPosition(page, sourceSelector, targetX, targetY)`

Implementiert @dnd-kit-kompatibles Drag & Drop:
1. Source-Element finden und Bounding Box ermitteln
2. Maus zu Source-Center bewegen
3. Mouse Down
4. 10px bewegen (aktiviert PointerSensor, distance > 8px)
5. In Steps zum Ziel bewegen
6. Mouse Up

**Wichtig:** @dnd-kit benötigt echte Mausbewegungen, keine `dragTo()`-Methode.

---

## Test 1: Divider via Drag & Drop an Position 0 erstellen (SSE Test)

**Funktion:** Testet Drag & Drop-Erstellung und SSE-Update

**Schritte:**
1. Zu "Kapitel 1" navigieren
2. `segment-list` finden und Bounding Box ermitteln
3. Segment-Count vor Erstellung merken
4. Drop-Position berechnen: Center-X, Y = listBox.y + 120
5. `create-divider-button` zur Drop-Position ziehen
6. Warten: `quick-create-divider-dialog` wird sichtbar
7. Klick auf `quick-create-divider-submit` (Standard 2s Pause)
8. Warten: Dialog schließt sich
9. **KEIN** Page-Refresh/Navigation!
10. Warten auf SSE: Segment-Count erhöht sich um 1
11. Prüfung: Erstes List-Item enthält "Szenenumbruch"

**Erwartetes Ergebnis:**
- Drag & Drop funktioniert mit @dnd-kit
- Divider wird an Position 0 eingefügt
- UI aktualisiert sich via SSE (ohne Refresh)

---

## Test 2: Title Segment "Kapitel 1" via Drag & Drop an Position 0 erstellen (SSE Test)

**Funktion:** Testet Text-Segment-Erstellung und Reihenfolge

**Schritte:**
1. Zu "Kapitel 1" navigieren
2. Prüfung: Erstes Item ist "Szenenumbruch" (vom vorherigen Test)
3. `segment-list` Bounding Box ermitteln
4. Segment-Count vor Erstellung merken
5. Drop-Position: listBox.y + 120 (vor erstem Item)
6. `create-segment-button` zur Drop-Position ziehen
7. Warten: `quick-create-segment-dialog` wird sichtbar
8. Text eingeben: "Kapitel 1" in `quick-create-segment-text-input`
9. Klick auf `quick-create-segment-submit`
10. Warten: Dialog schließt sich
11. **KEIN** Page-Refresh/Navigation!
12. Warten auf SSE: Segment-Count erhöht sich um 1
13. Prüfung: Erstes Item ist "Kapitel 1", zweites ist "Szenenumbruch"

**Erwartetes Ergebnis:**
- Text-Segment wird an Position 0 eingefügt
- Bestehende Segmente werden nach unten verschoben
- Reihenfolge: Title → Divider → Text-Segmente

---

## Test 3: Segment-Struktur verifizieren

**Funktion:** Prüft die Gesamtstruktur nach Drag & Drop-Erstellungen

**Schritte:**
1. Zu "Kapitel 1" navigieren
2. `segment-list` finden
3. Total-Segments zählen (via menu-buttons)
4. Prüfung: Mindestens 3 Segmente vorhanden
5. Position 0 prüfen: Enthält "Kapitel 1"
6. Position 1 prüfen: Enthält "Szenenumbruch"
7. Position 2+ prüfen: Enthält Text aus Upload ("Kunst des Geschichtenerzählens")

**Erwartetes Ergebnis:**
- Struktur: Title → Divider → Story-Text
- Alle Segmente korrekt positioniert

---

## Test 4: Segment-Text via EditSegmentDialog bearbeiten

**Funktion:** Testet Text-Bearbeitung und SSE-Update

**Schritte:**
1. Zu "Kapitel 1" navigieren
2. Erstes Segment finden ("Kapitel 1")
3. Klick auf `segment-menu-button` (erstes)
4. Klick auf `segment-menu-edit`
5. Warten: `edit-segment-dialog` wird sichtbar
6. `edit-segment-text-editor` finden
7. Text ändern: Ctrl+A, dann "Kapitel 1 - Einleitung" eingeben
8. Klick auf `edit-segment-save-button`
9. Warten: Dialog schließt sich
10. **KEIN** Page-Refresh/Navigation!
11. Warten auf SSE: Erstes Item enthält "Kapitel 1 - Einleitung"

**Erwartetes Ergebnis:**
- Text wird erfolgreich geändert
- UI aktualisiert sich via SSE

---

## Test 5: Segment-Speaker via EditSegmentSettingsDialog ändern

**Funktion:** Testet Speaker-Änderung und SSE-Update

**Schritte:**
1. Zu "Kapitel 1" navigieren
2. Erstes Segment finden ("Kapitel 1 - Einleitung")
3. Klick auf `segment-menu-button` (erstes)
4. Klick auf `segment-menu-settings`
5. Warten: `segment-settings-dialog` wird sichtbar
6. `segment-settings-speaker-select` öffnen
7. "Test Speaker 3" auswählen
8. Klick auf Save Button
9. Warten: Dialog schließt sich
10. **KEIN** Page-Refresh/Navigation!
11. Settings erneut öffnen
12. Prüfung: Speaker ist "Test Speaker 3"

**Erwartetes Ergebnis:**
- Speaker wird erfolgreich geändert
- Änderung persistiert (via SSE oder Re-Open bestätigt)

---

## Test 6: Segment via SegmentMenu löschen

**Funktion:** Testet Segment-Löschung mit Confirmation Dialog

**Schritte:**
1. Zu "Kapitel 1" navigieren
2. Segment-Count vor Löschung merken
3. Letztes Segment finden (um Struktur zu erhalten)
4. Klick auf `segment-menu-button` (letztes)
5. Klick auf `segment-menu-delete`
6. Warten: `confirm-dialog` wird sichtbar
7. Klick auf `confirm-dialog-confirm`
8. Warten: Dialog schließt sich
9. **KEIN** Page-Refresh/Navigation!
10. Warten auf SSE: Segment-Count verringert sich um 1

**Erwartetes Ergebnis:**
- Confirmation Dialog erscheint
- Segment wird nach Bestätigung gelöscht
- UI aktualisiert sich via SSE

---

## Test 7: CHECKPOINT - Segment CRUD verifiziert

**Funktion:** Fail-Fast Checkpoint für Segment-Operationen

**Schritte:**
1. `checkpoint()` Funktion aufrufen mit Check "Segment CRUD verified"
2. Zu "Kapitel 1" navigieren
3. `segment-list` muss sichtbar sein
4. Prüfung: Mindestens 1 Segment vorhanden
5. Prüfung: Erstes Segment enthält "Kapitel 1 - Einleitung"
6. Prüfung: Zweites Segment enthält "Szenenumbruch"

**Erwartetes Ergebnis:**
- Alle CRUD-Operationen haben funktioniert
- Struktur ist wie erwartet

**Bei Fehler:**
- Checkpoint schlägt fehl
- Weitere Tests sollten überprüft werden

---

## SSE-Testing-Hinweise

**Wichtig:** Diese Test-Suite prüft explizit SSE-Updates:

1. **Keine Navigation nach Änderungen** - Die Tests navigieren NICHT weg und zurück nach CRUD-Operationen
2. **`expect.toPass()` Pattern** - Verwendet `await expect(async () => {...}).toPass({ timeout: 5000 })` für SSE-Wartelogik
3. **Count-basierte Validierung** - Segment-Counts werden vor/nach Operationen verglichen
4. **Text-basierte Validierung** - List-Item-Inhalte werden direkt geprüft

**Beispiel SSE-Warte-Pattern:**
```typescript
await expect(async () => {
  const count = await page.getByTestId('segment-menu-button').count()
  expect(count).toBe(expectedCount)
}).toPass({ timeout: 5000 })
```
