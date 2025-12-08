# 07-TTS-Workflow Tests

**Datei:** `tests/07-tts-workflow.spec.ts`
**Voraussetzung:** 05-text-upload muss bestanden sein (Segmente in Kapitel 1 & 2)
**Laufzeit:** ~60-90s (echte TTS-Generierung)

## Übersicht

Echte E2E-Tests für TTS-Generierung. Alle Operationen nutzen echte TTS-Engines (XTTS/Chatterbox) - keine Mocks.

**Wichtig:**
- Tests erfordern laufende TTS-Engine (Worker startet automatisch)
- Generierung dauert ~5-15s pro Segment (Timeout: 30s)
- Generierte Audio-Dateien bleiben für Folgetests (AudioPlayer, Quality)
- SSE-Events signalisieren Abschluss (kein Polling nötig)

**Test-IDs verwendet:**
- `segment-status` - Status-Chip auf Segment (zeigt pending/processing/completed)
- `play-button` - Play-Button für Audio-Vorschau (auf Segment)
- `generate-chapter-button` - "Kapitel generieren" Button in MainView Header
- `generate-audio-dialog` - GenerateAudioDialog
- `generate-audio-submit` - "Generieren" Button im Dialog
- `generate-audio-cancel` - "Abbrechen" Button im Dialog
- `nav-monitoring` - Navigation zu Monitoring View
- `tts-jobs-tab` - TTS Jobs Tab in Monitoring
- `tts-jobs-active-list` - Liste der aktiven TTS Jobs
- `tts-jobs-finished-list` - Liste der abgeschlossenen TTS Jobs
- `tts-job-item-{id}` - Einzelner Job-Eintrag
- `tts-job-cancel-{id}` - Cancel/Pause Button
- `tts-job-resume-{id}` - Resume Button
- `tts-job-delete-{id}` - Delete Button

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

## Test 1: TTS-Engine Status prüfen

**Funktion:** Verifiziert, dass mindestens eine TTS-Engine verfügbar ist

**Schritte:**
1. Zu Main View navigieren (`nav-main`)
2. Testprojekt → Kapitel 1 auswählen
3. Prüfung: `generate-chapter-button` ist sichtbar und NICHT disabled
4. Falls Button disabled: Test überspringen mit Hinweis "No TTS engine available"

**Erwartetes Ergebnis:**
- Generate-Button ist klickbar (Engine verfügbar)
- Worker kann Generierung starten

**Bei Fehler:**
- Skip remaining tests mit Meldung "No TTS engine available"

**Hinweis:** Der Button ist nur enabled, wenn mindestens eine TTS-Engine verfügbar ist.

---

## Test 2: Kapitel 1 Generierung starten

**Funktion:** Testet die Batch-Generierung via GenerateAudioDialog

**Schritte:**
1. Zu "Kapitel 1" navigieren (Testprojekt → Kapitel 1)
2. Segment-Count ermitteln (nur Text-Segmente, keine Divider)
3. Prüfung: Mindestens ein Segment hat Status `pending`
4. Klick auf `generate-chapter-button`
5. Warten: `generate-audio-dialog` wird sichtbar
6. Prüfung: Dialog zeigt Segment-Anzahl
7. Klick auf `generate-audio-submit`
8. Warten: Dialog schließt sich

**Erwartetes Ergebnis:**
- GenerateAudioDialog öffnet sich
- Job wird nach Bestätigung erstellt
- Dialog schließt automatisch

---

## Test 3: Job-Fortschritt in Monitoring verfolgen

**Funktion:** Testet die Fortschrittsanzeige via SSE

**Schritte:**
1. Zu Monitoring View wechseln (`nav-monitoring`)
2. TTS Jobs Tab sollte bereits aktiv sein (oder `tts-jobs-tab` klicken)
3. Aktiven Job in `tts-jobs-active-list` finden
4. Prüfung: Job erscheint mit Status "running" oder "pending"
5. Fortschrittsanzeige beobachten (x/y Segmente im JobCard)
6. Warten auf SSE: Progress erhöht sich
7. Warten auf SSE: Job-Status wechselt zu `completed` (timeout: 60s)

**Erwartetes Ergebnis:**
- Job erscheint in Active Jobs Liste
- Fortschritt wird live aktualisiert via SSE
- Job schließt erfolgreich ab

---

## Test 4: Kapitel 1 Segmente haben Audio

**Funktion:** Verifiziert, dass alle Segmente nach Batch-Generierung Audio haben

**Schritte:**
1. Zurück zu Main View (`nav-main`)
2. Zu "Kapitel 1" navigieren
3. Alle Text-Segmente durchgehen (via `segment-status` Chips)
4. Prüfung: Jedes Text-Segment hat `play-button` sichtbar
5. Prüfung: Divider haben keinen Play-Button (korrekt übersprungen)

**Erwartetes Ergebnis:**
- Alle Text-Segmente wurden generiert
- Divider wurden korrekt übersprungen
- Play-Buttons erscheinen für alle generierten Segmente

---

## Test 5: Audio-Vorschau abspielen

**Funktion:** Testet die Wiedergabe eines generierten Segments

**Schritte:**
1. In Kapitel 1 bleiben
2. Erstes Text-Segment mit `play-button` finden
3. Klick auf `play-button`
4. Prüfung: Audio spielt ab (Button wechselt zu Pause-Icon oder Audio-Element aktiv)
5. Kurz warten (1-2s)
6. Erneut klicken zum Stoppen

**Erwartetes Ergebnis:**
- Audio-Vorschau funktioniert
- Play/Pause Toggle funktioniert

---

## Test 6: Kapitel 2 Generierung starten

**Funktion:** Testet Generierung eines zweiten Kapitels

**Schritte:**
1. Zu "Kapitel 2" navigieren
2. Segment-Count ermitteln
3. Klick auf `generate-chapter-button`
4. Warten: `generate-audio-dialog` wird sichtbar
5. Klick auf `generate-audio-submit`
6. Warten: Dialog schließt sich
7. Zu Monitoring View wechseln
8. Warten auf SSE: Job-Status wechselt zu `completed` (timeout: 60s)

**Erwartetes Ergebnis:**
- Zweites Kapitel wird generiert
- Job erscheint in Monitoring und schließt ab

---

## Test 7: Job abbrechen und fortsetzen

**Funktion:** Testet Cancel und Resume eines Jobs

**Schritte:**
1. Zurück zu Main View
2. Zu "Kapitel 1" navigieren
3. Klick auf `generate-chapter-button` (zeigt "Alles neu generieren")
4. Im Dialog: "Bereits generierte Segmente überschreiben" aktivieren
5. Klick auf `generate-audio-submit`
6. Sofort zu Monitoring View wechseln
7. Aktiven Job finden
8. Klick auf `tts-job-cancel-{id}`
9. Prüfung: Job-Status wechselt zu `cancelled`
10. Prüfung: `tts-job-resume-{id}` ist sichtbar
11. Klick auf `tts-job-resume-{id}`
12. Prüfung: Job-Status wechselt zu `running`
13. Warten auf SSE: Job-Status wechselt zu `completed` (timeout: 60s)

**Erwartetes Ergebnis:**
- Job kann abgebrochen werden
- Job kann fortgesetzt werden
- Nur fehlende Segmente werden nach Resume generiert

---

## Test 8: CHECKPOINT - Segmente haben Audio

**Funktion:** Fail-Fast Checkpoint für nachfolgende Test-Suites (AudioPlayer, Quality)

**Schritte:**
1. `checkpoint()` Funktion aufrufen mit Check "Segments have audio"
2. Zu Kapitel 1 navigieren
3. **UI-Verifikation:** Mindestens 3 `play-button` Elemente sichtbar
4. Zu Kapitel 2 navigieren
5. **UI-Verifikation:** Mindestens 3 `play-button` Elemente sichtbar
6. Optional API-Bestätigung: `GET /api/chapters/{id}` → `audioPath` nicht null

**Erwartetes Ergebnis:**
- Beide Kapitel haben sichtbare Play-Buttons (= Audio generiert)
- Nachfolgende Tests (08-audio-player, 09-quality) können ausgeführt werden

**Bei Fehler:**
- Checkpoint schlägt fehl
- AudioPlayer und Quality Tests werden fehlschlagen

---

## Timing & Timeouts

| Operation | Erwartete Dauer | Timeout |
|-----------|-----------------|---------|
| Dialog öffnen/schließen | <1s | 5s |
| Kapitel (5 Segmente) | 25-75s | 90s |
| Job Cancel | sofort | 5s |
| Job Resume | sofort | 5s |
| SSE Status-Update | <1s | 5s |

---

## SSE Events

Die Tests verlassen sich auf folgende SSE Events:

| Event | Channel | Beschreibung |
|-------|---------|--------------|
| `segment.updated` | jobs | Segment-Status geändert |
| `segment.completed` | jobs | Audio-Generierung abgeschlossen |
| `tts_job.created` | jobs | Neuer Job erstellt |
| `tts_job.progress` | jobs | Job-Fortschritt aktualisiert |
| `tts_job.completed` | jobs | Job abgeschlossen |
| `tts_job.cancelled` | jobs | Job abgebrochen |

---

## Hinweise zur Implementierung

1. **Keine Einzelsegment-Generierung** - Die App generiert nur auf Kapitel-Ebene via `GenerateAudioDialog`
2. **GenerateAudioDialog** - Wird über `generate-chapter-button` in MainView geöffnet
3. **Regeneration** - Über Checkbox "Bereits generierte überschreiben" im Dialog
4. **Job-Tracking** - Jobs erscheinen in Monitoring View unter TTS Jobs Tab
5. **SSE-basierte Updates** - Kein Polling nötig, alle Status-Updates via SSE
