# 05-Text-Upload Tests

**Datei:** `tests/05-text-upload.spec.ts`
**Voraussetzung:** 04-project-chapter muss bestanden sein (Testprojekt mit 2 Kapiteln)
**Laufzeit:** ~20s

## Übersicht

Echte E2E-Tests für Text-Upload. Testet beide Upload-Methoden (TextField und File Upload) mit verschiedenen Speakern.

**Test-IDs verwendet:**
- `upload-text-button` - "Text hochladen" Button in ChapterView
- `text-upload-dialog` - Text Upload Dialog
- `text-upload-text-input` - TextField für manuellen Text
- `file-input` - File Input für Datei-Upload
- `selected-file-info` - Anzeige der ausgewählten Datei
- `text-upload-tts-accordion` - TTS-Optionen Accordion
- `text-upload-speaker-select` - Speaker Dropdown
- `text-upload-submit-button` - Submit Button
- `segment-menu-button` - Menü Button auf Segment
- `segment-menu-settings` - "Einstellungen" im Segment-Menü
- `segment-settings-dialog` - Segment Settings Dialog
- `segment-settings-speaker-select` - Speaker Dropdown im Settings Dialog

---

## Setup: beforeAll / afterAll

**beforeAll:**
1. Test-Textdatei erstellen (test-upload.txt mit ~1 A4 Seite Text)

**afterAll:**
1. Test-Textdatei löschen

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

## Test 1: Text zu Kapitel 1 mit Test Speaker 2 hochladen

**Funktion:** Testet manuellen Text-Upload über TextField mit Speaker-Auswahl

**Schritte:**
1. "Testprojekt" finden und expandieren
2. "Kapitel 1" auswählen
3. Klick auf `upload-text-button`
4. Warten: `text-upload-dialog` wird sichtbar
5. Langen Text eingeben in `text-upload-text-input` (~5 Absätze)
6. Klick auf `text-upload-tts-accordion` (TTS-Optionen öffnen)
7. Current Speaker prüfen (sollte Default sein)
8. "Test Speaker 2" auswählen in `text-upload-speaker-select`
9. Klick auf `text-upload-submit-button`
10. Warten: Dialog schließt sich
11. API-Verifikation: Kapitel 1 hat Segmente
12. API-Verifikation: Erstes Segment hat `ttsSpeakerName: "Test Speaker 2"`

**Erwartetes Ergebnis:**
- Text wird segmentiert und hochgeladen
- Segmente erhalten korrekten Speaker
- Dialog schließt nach erfolgreichem Upload

---

## Test 2: Text-Datei zu Kapitel 2 mit Test Speaker 3 hochladen

**Funktion:** Testet Datei-Upload mit anderem Speaker

**Schritte:**
1. "Testprojekt" finden und expandieren
2. "Kapitel 2" auswählen
3. Klick auf `upload-text-button`
4. Warten: `text-upload-dialog` wird sichtbar
5. Test-Textdatei hochladen via `file-input`
6. Prüfung: `selected-file-info` zeigt Dateinamen
7. Klick auf `text-upload-tts-accordion` (TTS-Optionen öffnen)
8. "Test Speaker 3" auswählen in `text-upload-speaker-select`
9. Klick auf `text-upload-submit-button`
10. Warten: Dialog schließt sich
11. API-Verifikation: Kapitel 2 hat Segmente
12. API-Verifikation: Erstes Segment hat `ttsSpeakerName: "Test Speaker 3"`

**Erwartetes Ergebnis:**
- Datei-Inhalt wird segmentiert und hochgeladen
- Segmente erhalten korrekten Speaker
- File Upload funktioniert korrekt

---

## Test 3: CHECKPOINT - Beide Kapitel haben Segmente

**Funktion:** Fail-Fast Checkpoint für nachfolgende Test-Suites

**Schritte:**
1. `checkpoint()` Funktion aufrufen mit Check "Both chapters have segments"
2. API-Abfrage: `GET /api/projects`
3. "Testprojekt" finden
4. "Kapitel 1" ID ermitteln
5. API-Abfrage: `GET /api/chapters/{kapitel1Id}`
6. Prüfung: `segments.length > 0`
7. "Kapitel 2" ID ermitteln
8. API-Abfrage: `GET /api/chapters/{kapitel2Id}`
9. Prüfung: `segments.length > 0`

**Erwartetes Ergebnis:**
- Beide Kapitel haben mindestens 1 Segment
- Nachfolgende Tests (06-segment) können ausgeführt werden

**Bei Fehler:**
- Checkpoint schlägt fehl
- Nachfolgende Test-Suites sollten übersprungen werden

---

## Test 4: Kapitel 1 erstes Segment hat Test Speaker 2 (via Settings Dialog)

**Funktion:** Verifiziert Speaker-Zuweisung über UI

**Schritte:**
1. "Testprojekt" expandieren, "Kapitel 1" auswählen
2. Erstes Segment finden
3. Klick auf `segment-menu-button` (erstes)
4. Klick auf `segment-menu-settings`
5. Warten: `segment-settings-dialog` wird sichtbar
6. Prüfung: `segment-settings-speaker-select` zeigt "Test Speaker 2"
7. Dialog schließen (Escape)

**Erwartetes Ergebnis:**
- Settings Dialog zeigt korrekten Speaker
- Speaker-Zuweisung aus Upload wurde korrekt gespeichert

---

## Test 5: Kapitel 2 erstes Segment hat Test Speaker 3 (via Settings Dialog)

**Funktion:** Verifiziert Speaker-Zuweisung für zweites Kapitel

**Schritte:**
1. "Testprojekt" expandieren, "Kapitel 2" auswählen
2. Erstes Segment finden
3. Klick auf `segment-menu-button` (erstes)
4. Klick auf `segment-menu-settings`
5. Warten: `segment-settings-dialog` wird sichtbar
6. Prüfung: `segment-settings-speaker-select` zeigt "Test Speaker 3"
7. Dialog schließen (Escape)

**Erwartetes Ergebnis:**
- Settings Dialog zeigt korrekten Speaker
- Unterschiedliche Speaker pro Kapitel funktioniert
