# 01-Smoke Tests

**Datei:** `tests/01-smoke.spec.ts`
**Voraussetzung:** Tauri-App läuft mit CDP auf Port 9222
**Laufzeit:** ~8s

## Übersicht

Echte E2E-Tests die als erstes laufen müssen. Testet die Gate-Funktion (EmptySpeakersState) und erstellt den ersten Speaker via UI.

**Test-IDs verwendet:**
- `empty-speakers-state` - EmptySpeakersState Container
- `empty-speakers-create-button` - "Ersten Speaker erstellen" Button
- `speaker-edit-modal` - Create/Edit Dialog
- `speaker-name-input` - Name Eingabefeld
- `speaker-description-input` - Description Eingabefeld
- `speaker-gender-select` - Gender Dropdown
- `speaker-sample-file-input` - Audio Sample Upload
- `speaker-save-button` - Speichern Button
- `nav-*` - Navigation Buttons
- `*-view` - View Container

---

## Setup: beforeAll / afterAll

**beforeAll:**
1. Test-WAV-Datei erstellen (smoke-test-sample.wav, 2 Sekunden)

**afterAll:**
1. Test-WAV-Datei löschen

---

## Test 1: EmptySpeakersState Gate anzeigen

**Funktion:** Prüft, ob das Gate korrekt angezeigt wird wenn keine Speaker existieren

**Schritte:**
1. Backend komplett leeren (alle Projects, Speakers, Pronunciation Rules löschen)
2. Seite neu laden und verbinden
3. Prüfung: `speakers-view` ist sichtbar
4. Prüfung: `empty-speakers-state` ist sichtbar

**Erwartetes Ergebnis:**
- Gate wird angezeigt wenn keine Speaker existieren
- App leitet automatisch zur Speakers-View

---

## Test 2: Gate blockiert andere Views

**Funktion:** Prüft, ob Navigation zu anderen Views blockiert ist

**Schritte:**
1. Prüfung: `empty-speakers-state` ist sichtbar
2. Klick auf `nav-main`
3. 500ms warten
4. Prüfung: `speakers-view` ist noch sichtbar (Main blockiert)
5. Klick auf `nav-settings`
6. Prüfung: Settings ist entweder sichtbar (erlaubt) oder blockiert

**Erwartetes Ergebnis:**
- Main View ist blockiert durch Gate
- Settings View kann erlaubt sein (Konfiguration möglich)
- User muss erst Speaker erstellen

---

## Test 3: Ersten Speaker via UI erstellen

**Funktion:** Testet den kompletten First-Time-User-Flow

**Schritte:**
1. Prüfung: `empty-speakers-state` ist sichtbar
2. Klick auf `empty-speakers-create-button`
3. Warten: `speaker-edit-modal` wird sichtbar
4. Name eingeben: "Test Speaker"
5. "Optionale Details" Accordion aufklappen
6. Description eingeben: "Default test speaker for E2E tests"
7. Gender auswählen: "Neutral"
8. Audio Sample hochladen (Test-WAV)
9. Klick auf `speaker-save-button`
10. Warten: Modal schließt sich
11. Prüfung: `empty-speakers-state` ist verschwunden
12. Prüfung: "Test Speaker" erscheint in der Liste
13. Speaker als Default setzen (via API)

**Erwartetes Ergebnis:**
- First-Time-User-Flow funktioniert komplett
- Speaker wird erstellt
- Gate verschwindet
- Speaker-Liste wird angezeigt

---

## Test 4: Alle Views erreichbar nach Speaker-Erstellung

**Funktion:** Prüft, ob alle 6 Views nach Entsperrung erreichbar sind

**Schritte:**
1. Klick auf `nav-main` → Prüfung: `main-view` sichtbar
2. Klick auf `nav-import` → Prüfung: `import-view` sichtbar
3. Klick auf `nav-speakers` → Prüfung: `speakers-view` sichtbar
4. Klick auf `nav-pronunciation` → Prüfung: `pronunciation-view` sichtbar
5. Klick auf `nav-monitoring` → Prüfung: `monitoring-view` sichtbar
6. Klick auf `nav-settings` → Prüfung: `settings-view` sichtbar

**Erwartetes Ergebnis:**
- Alle 6 Views sind jetzt erreichbar
- Gate blockiert nicht mehr

---

## Test 5: CHECKPOINT - Default Speaker existiert

**Funktion:** Fail-Fast Checkpoint für nachfolgende Test-Suites

**Schritte:**
1. `checkpoint()` Funktion aufrufen mit Check "Default Speaker Exists"
2. API-Abfrage: `GET /api/speakers/default/get`
3. Prüfung: Response ist OK (Status 200)
4. Prüfung: Speaker-Objekt hat `id` und `name`

**Erwartetes Ergebnis:**
- Ein Default Speaker existiert
- Nachfolgende Tests (02-navigation, 03-speaker, etc.) können ausgeführt werden

**Bei Fehler:**
- Checkpoint schlägt fehl
- Nachfolgende Test-Suites sollten übersprungen werden (Fail-Fast)
