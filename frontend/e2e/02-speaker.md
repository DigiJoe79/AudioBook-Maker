# 02-Speaker Tests

**Datei:** `tests/02-speaker.spec.ts`
**Voraussetzung:** 01-smoke muss bestanden sein (Base Speaker existiert)
**Laufzeit:** ~12s

## Übersicht

Echte E2E-Tests für Speaker-Management. Alle Operationen laufen über die UI, nicht über API-Calls.

**Test-IDs verwendet:**
- `speaker-add-button` - Add Button in ViewHeader
- `speaker-edit-modal` - Create/Edit Dialog
- `speaker-name-input` - Name Eingabefeld
- `speaker-description-input` - Description Eingabefeld
- `speaker-gender-select` - Gender Dropdown
- `speaker-sample-file-input` - Audio Sample Upload
- `speaker-save-button` - Speichern Button
- `speaker-card-{id}` - Speaker Card
- `speaker-edit-button-{id}` - Edit Button auf Card
- `speaker-menu-button-{id}` - Menü Button (3 Punkte) auf Card
- `speaker-menu-set-default` - "Als Standard setzen" im Kontextmenü
- `speaker-menu-delete` - "Löschen" im Kontextmenü
- `confirm-dialog` - Bestätigungsdialog
- `confirm-dialog-confirm` - Bestätigen Button im Dialog

---

## Setup: beforeAll / afterAll

**beforeAll:**
1. Test-WAV-Dateien erstellen (speaker-test-1.wav, speaker-test-2.wav)
2. Dateien werden im e2e/ Ordner erzeugt

**afterAll:**
1. Test-WAV-Dateien löschen

---

## beforeEach: Speakers View öffnen

**Schritte (vor jedem Test):**
1. URL prüfen - falls nicht auf `/app`:
   - "Verbinden/Connect" Button finden und klicken
   - Warten auf URL `**/app`
2. Prüfung: `app-layout` ist sichtbar
3. Klick auf `nav-speakers`
4. Prüfung: `speakers-view` ist sichtbar

---

## Test 1: Base Speaker anzeigen

**Funktion:** Prüft, ob der Base Speaker in der UI sichtbar ist

**Schritte:**
1. 500ms warten (SSE-Update nach Backend-Reset)
2. Prüfung: Text mit Speaker-Name ist sichtbar

**Erwartetes Ergebnis:**
- Base Speaker ("Test Speaker") wird in der Speaker-Liste angezeigt

---

## Test 2: Neuen Speaker via UI erstellen

**Funktion:** Testet den kompletten Create-Workflow über den Dialog

**Schritte:**
1. Klick auf `speaker-add-button` (Add-Button)
2. Warten: `speaker-edit-modal` wird sichtbar
3. Name eingeben: "E2E UI Speaker" in `speaker-name-input`
4. "Optionale Details" Accordion aufklappen
5. Description eingeben: "Created via E2E UI test" in `speaker-description-input`
6. Gender auswählen: "Weiblich/Female" in `speaker-gender-select`
7. Audio Sample hochladen: Test-WAV in `speaker-sample-file-input`
8. Klick auf `speaker-save-button`
9. Warten: Modal schließt sich
10. Prüfung: "E2E UI Speaker" erscheint in der Liste

**Erwartetes Ergebnis:**
- Speaker wird erfolgreich über UI erstellt
- Dialog funktioniert korrekt
- Neuer Speaker erscheint nach SSE-Update

---

## Test 3: Speaker via UI bearbeiten

**Funktion:** Testet den Edit-Workflow über den Dialog

**Schritte:**
1. Prüfung: "E2E UI Speaker" existiert (sonst skip)
2. Speaker-Card finden und Edit-Button klicken (`speaker-edit-button-{id}`)
3. Warten: `speaker-edit-modal` wird sichtbar
4. Name ändern: "E2E UI Speaker (Edited)"
5. Klick auf `speaker-save-button`
6. Warten: Modal schließt sich
7. Prüfung: "E2E UI Speaker (Edited)" erscheint in der Liste

**Erwartetes Ergebnis:**
- Speaker wird erfolgreich bearbeitet
- Geänderter Name erscheint sofort

---

## Test 4: Speaker suchen und filtern

**Funktion:** Prüft die Suchfunktion (durchsucht Name, Description, Gender, Tags)

**Schritte:**
1. "Search Test Speaker" erstellen falls nicht vorhanden (API-Setup)
2. View refreshen
3. Suchbox finden (Placeholder "Search/Suchen")
4. "Unique" eingeben (nur in Search Test Speaker's Description)
5. 400ms warten (Debounce)
6. Prüfung: "Search Test Speaker" ist sichtbar
7. Prüfung: Base Speaker ist NICHT sichtbar
8. Suchbox leeren
9. 400ms warten
10. Prüfung: Beide Speaker sind wieder sichtbar

**Erwartetes Ergebnis:**
- Suche filtert Speaker-Liste korrekt
- Leere Suche zeigt alle Speaker

---

## Test 5: Speaker als Default setzen via Kontextmenü

**Funktion:** Testet das Setzen eines Default Speakers über das UI-Kontextmenü

**Schritte:**
1. Test-Speaker finden (E2E UI Speaker oder Search Test Speaker)
2. Menü-Button klicken (`speaker-menu-button-{id}`)
3. Warten: Kontextmenü erscheint
4. Klick auf `speaker-menu-set-default`
5. Warten auf Snackbar/Feedback
6. Cleanup: Original-Default wiederherstellen (API)

**Erwartetes Ergebnis:**
- Kontextmenü öffnet sich
- "Als Standard setzen" funktioniert
- UI zeigt neuen Default an

---

## Test 6: Test-Speaker via Kontextmenü löschen

**Funktion:** Testet das Löschen eines Speakers über das UI-Kontextmenü

**Schritte:**
1. "E2E UI Speaker" finden (sonst skip)
2. Base Speaker als Default setzen (kann Default nicht löschen)
3. Menü-Button klicken (`speaker-menu-button-{id}`)
4. Warten: Kontextmenü erscheint
5. Klick auf `speaker-menu-delete`
6. Warten: Bestätigungsdialog (`confirm-dialog`) erscheint
7. Klick auf `confirm-dialog-confirm` (Ja/Yes Button)
8. 1s warten
9. Prüfung: "E2E UI Speaker" ist verschwunden

**Erwartetes Ergebnis:**
- Lösch-Workflow funktioniert komplett
- Bestätigungsdialog erscheint
- Speaker wird nach Bestätigung entfernt

---

## Test 7: 3 Audio-Samples zu Search Test Speaker hinzufügen

**Funktion:** Testet das Hinzufügen mehrerer Audio-Samples zu einem bestehenden Speaker

**Schritte:**
1. "Search Test Speaker" in der Liste finden (sonst skip)
2. Edit-Button auf der Speaker-Card klicken (`speaker-edit-button-{id}`)
3. Warten: `speaker-edit-modal` wird sichtbar
4. 3 Audio-Samples hochladen via `speaker-sample-file-input` (Multi-Select)
5. Klick auf `speaker-save-button`
6. Warten: Modal schließt sich

**Erwartetes Ergebnis:**
- Mehrere Audio-Samples können gleichzeitig hochgeladen werden
- Speaker wird mit neuen Samples aktualisiert

---

## Test 8: Search Test Speaker zu "Test Speaker 2" umbenennen

**Funktion:** Testet das Umbenennen eines Speakers für nachfolgende Tests

**Schritte:**
1. "Search Test Speaker" in der Liste finden (sonst skip)
2. Edit-Button auf der Speaker-Card klicken (`speaker-edit-button-{id}`)
3. Warten: `speaker-edit-modal` wird sichtbar
4. Name ändern: "Test Speaker 2" in `speaker-name-input`
5. Klick auf `speaker-save-button`
6. Warten: Modal schließt sich
7. Prüfung: "Test Speaker 2" erscheint in der Liste
8. Prüfung: "Search Test Speaker" ist verschwunden

**Erwartetes Ergebnis:**
- Speaker wird erfolgreich umbenannt
- Neuer Name erscheint sofort in der Liste
- "Test Speaker 2" steht für 05-text-upload Tests bereit

---

## Test 9: "Test Speaker 3" mit 3 Audio-Samples erstellen

**Funktion:** Erstellt dritten Test-Speaker für 05-text-upload Tests

**Schritte:**
1. Klick auf `speaker-add-button`
2. Warten: `speaker-edit-modal` wird sichtbar
3. Name eingeben: "Test Speaker 3" in `speaker-name-input`
4. "Optionale Details" Accordion aufklappen
5. Description eingeben: "Third test speaker with 3 samples"
6. Gender auswählen: "Männlich/Male" in `speaker-gender-select`
7. 3 Audio-Samples hochladen via `speaker-sample-file-input`
8. Klick auf `speaker-save-button`
9. Warten: Modal schließt sich
10. Prüfung: "Test Speaker 3" erscheint in der Liste

**Erwartetes Ergebnis:**
- Speaker mit 3 Samples wird erstellt
- "Test Speaker 3" steht für 05-text-upload Tests bereit

---

## Test 10: CHECKPOINT - Default Speaker existiert

**Funktion:** Fail-Fast Checkpoint für nachfolgende Test-Suites

**Schritte:**
1. `checkpoint()` Funktion aufrufen mit Check "Default Speaker Exists"
2. API-Abfrage: `GET /api/speakers/default/get`
3. Prüfung: Response ist OK (Status 200)
4. Prüfung: Speaker-Objekt hat `id` und `name`

**Erwartetes Ergebnis:**
- Mindestens ein Default Speaker existiert
- Test Speaker 2 und Test Speaker 3 existieren
- Nachfolgende Tests (04-project-chapter, 05-text-upload) können ausgeführt werden

**Bei Fehler:**
- Checkpoint schlägt fehl
- Nachfolgende Test-Suites sollten übersprungen werden (Fail-Fast)
