# 04-Project-Chapter Tests

**Datei:** `tests/04-project-chapter.spec.ts`
**Voraussetzung:** 01-smoke muss bestanden sein (Base Speaker existiert)
**Laufzeit:** ~15s

## Übersicht

Echte E2E-Tests für Project & Chapter CRUD. Alle Operationen laufen über die UI, nicht über API-Calls.

**Test-IDs verwendet:**
- `create-project-button` - "Neues Projekt" Button in Sidebar
- `project-dialog` - Create/Edit Project Dialog
- `project-title-input` - Projekt-Titel Eingabefeld
- `project-description-input` - Projekt-Beschreibung Eingabefeld
- `project-save-button` - Speichern Button im Dialog
- `project-item-{id}` - Projekt-Eintrag in Sidebar
- `project-menu-button-{id}` - Menü Button (3 Punkte) für Projekt
- `project-expand-button-{id}` - Expand Button für Kapitel-Liste
- `projects-menu-edit` - "Bearbeiten" im Kontextmenü
- `projects-menu-delete` - "Löschen" im Kontextmenü
- `create-chapter-button-{projectId}` - "Neues Kapitel" Button
- `chapter-dialog` - Create/Edit Chapter Dialog
- `chapter-title-input` - Kapitel-Titel Eingabefeld
- `chapter-save-button` - Speichern Button im Dialog
- `chapter-item-{id}` - Kapitel-Eintrag in Sidebar
- `confirm-dialog` - Bestätigungsdialog
- `confirm-dialog-confirm` - Bestätigen Button im Dialog

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

## Test 1: Erstes Projekt "Test Projekt 1" via UI erstellen

**Funktion:** Testet den Create-Workflow für Projekte

**Schritte:**
1. Alle bestehenden Projekte löschen (einmalig, erste Test-Run)
2. Klick auf `create-project-button`
3. Warten: `project-dialog` wird sichtbar
4. Titel eingeben: "Test Projekt 1" in `project-title-input`
5. Description eingeben: "Erstes Testprojekt" in `project-description-input`
6. Klick auf `project-save-button`
7. Warten: Dialog schließt sich
8. Prüfung: "Test Projekt 1" erscheint in der Sidebar

**Erwartetes Ergebnis:**
- Projekt wird erfolgreich erstellt
- Projekt erscheint in der Sidebar

---

## Test 2: Erstes Kapitel "Kapitel 1" via UI erstellen

**Funktion:** Testet den Create-Workflow für Kapitel

**Schritte:**
1. Projekt "Test Projekt 1" finden und auswählen
2. Projekt expandieren via `project-expand-button-{id}`
3. Klick auf `create-chapter-button-{projectId}`
4. Warten: `chapter-dialog` wird sichtbar
5. Titel eingeben: "Kapitel 1" in `chapter-title-input`
6. Klick auf `chapter-save-button`
7. Warten: Dialog schließt sich
8. Prüfung: "Kapitel 1" erscheint unter dem Projekt

**Erwartetes Ergebnis:**
- Kapitel wird erfolgreich erstellt
- Kapitel erscheint in der Projekt-Hierarchie

---

## Test 3: Zweites Kapitel "Kapitel 2" via UI erstellen

**Funktion:** Testet das Erstellen weiterer Kapitel

**Schritte:**
1. Projekt "Test Projekt 1" finden (sollte bereits expandiert sein)
2. Falls nicht expandiert: `project-expand-button-{id}` klicken
3. Klick auf `create-chapter-button-{projectId}`
4. Warten: `chapter-dialog` wird sichtbar
5. Titel eingeben: "Kapitel 2" in `chapter-title-input`
6. Klick auf `chapter-save-button`
7. Warten: Dialog schließt sich
8. Prüfung: "Kapitel 2" erscheint unter dem Projekt

**Erwartetes Ergebnis:**
- Zweites Kapitel wird erstellt
- Beide Kapitel sind sichtbar

---

## Test 4: Zweites Projekt "Test Projekt 2" via UI erstellen

**Funktion:** Testet das Erstellen mehrerer Projekte

**Schritte:**
1. Klick auf `create-project-button`
2. Warten: `project-dialog` wird sichtbar
3. Titel eingeben: "Test Projekt 2" in `project-title-input`
4. Klick auf `project-save-button`
5. Warten: Dialog schließt sich
6. Prüfung: "Test Projekt 2" erscheint in der Sidebar

**Erwartetes Ergebnis:**
- Zweites Projekt wird erstellt
- Beide Projekte sind sichtbar

---

## Test 5: "Test Projekt 1" zu "Testprojekt" umbenennen via UI

**Funktion:** Testet den Edit-Workflow für Projekte

**Schritte:**
1. Projekt "Test Projekt 1" finden
2. Klick auf `project-menu-button-{id}`
3. Warten: Kontextmenü erscheint
4. Klick auf `projects-menu-edit`
5. Warten: `project-dialog` wird sichtbar
6. Titel ändern: "Testprojekt"
7. Klick auf `project-save-button`
8. Warten: Dialog schließt sich
9. Prüfung: "Testprojekt" erscheint, "Test Projekt 1" ist verschwunden

**Erwartetes Ergebnis:**
- Projekt wird umbenannt
- Neuer Name erscheint sofort

---

## Test 6: "Test Projekt 2" via UI löschen

**Funktion:** Testet den Delete-Workflow für Projekte

**Schritte:**
1. Projekt "Test Projekt 2" finden
2. Klick auf `project-menu-button-{id}`
3. Warten: Kontextmenü erscheint
4. Klick auf `projects-menu-delete`
5. Warten: `confirm-dialog` erscheint
6. Klick auf `confirm-dialog-confirm`
7. Warten: Dialog schließt sich
8. Prüfung: "Test Projekt 2" ist verschwunden

**Erwartetes Ergebnis:**
- Projekt wird gelöscht
- Nur "Testprojekt" bleibt übrig

---

## Test 7: Finalen Zustand verifizieren

**Funktion:** Prüft, ob genau 1 Projekt mit 2 Kapiteln existiert

**Schritte:**
1. Prüfung: "Testprojekt" ist sichtbar
2. Prüfung: "Test Projekt 2" ist NICHT sichtbar
3. Projekt expandieren (falls nötig)
4. Prüfung: "Kapitel 1" ist sichtbar
5. Prüfung: "Kapitel 2" ist sichtbar
6. API-Verifikation: GET /api/projects
7. Prüfung: 1 Projekt mit title="Testprojekt", 2 Kapitel

**Erwartetes Ergebnis:**
- UI zeigt korrekten Zustand
- API bestätigt Datenbank-Zustand

---

## Test 8: CHECKPOINT - Testprojekt mit 2 Kapiteln existiert

**Funktion:** Fail-Fast Checkpoint für nachfolgende Test-Suites

**Schritte:**
1. `checkpoint()` Funktion aufrufen mit Check "Testprojekt with 2 chapters"
2. API-Abfrage: `GET /api/projects`
3. Prüfung: Genau 1 Projekt existiert
4. Prüfung: Projekt-Titel ist "Testprojekt"
5. Prüfung: Projekt hat genau 2 Kapitel
6. Prüfung: Kapitel-Titel sind "Kapitel 1" und "Kapitel 2"

**Erwartetes Ergebnis:**
- Testprojekt mit korrekter Struktur existiert
- Nachfolgende Tests (05-text-upload, etc.) können ausgeführt werden

**Bei Fehler:**
- Checkpoint schlägt fehl
- Nachfolgende Test-Suites sollten übersprungen werden (Fail-Fast)
