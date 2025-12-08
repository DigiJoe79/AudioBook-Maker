# 03-Navigation Tests

**Datei:** `tests/03-navigation.spec.ts`
**Voraussetzung:** 01-smoke muss bestanden sein (Base Speaker existiert)
**Laufzeit:** ~3s

## Übersicht

Testet das Teams/Discord-Style Navigationssystem mit 6 Views und Keyboard-Shortcuts.

---

## beforeEach: App-Verbindung sicherstellen

**Schritte (vor jedem Test):**
1. URL prüfen - falls nicht auf `/app`:
   - "Verbinden/Connect" Button finden und klicken
   - Warten auf URL `**/app`
2. Prüfung: `app-layout` ist sichtbar

---

## Test 1: Alle Navigations-Buttons sichtbar

**Funktion:** Prüft, ob alle 6 Nav-Buttons angezeigt werden

**Schritte:**
1. Prüfung: `nav-main` ist sichtbar
2. Prüfung: `nav-import` ist sichtbar
3. Prüfung: `nav-speakers` ist sichtbar
4. Prüfung: `nav-pronunciation` ist sichtbar
5. Prüfung: `nav-monitoring` ist sichtbar
6. Prüfung: `nav-settings` ist sichtbar

**Erwartetes Ergebnis:**
- Alle 6 Navigations-Buttons sind in der Sidebar sichtbar

---

## Test 2: Navigation durch Klicken

**Funktion:** Prüft View-Wechsel durch Button-Klicks

**Schritte:**
1. Klick auf `nav-main` → Prüfung: `main-view` sichtbar
2. Klick auf `nav-import` → Prüfung: `import-view` sichtbar
3. Klick auf `nav-speakers` → Prüfung: `speakers-view` sichtbar
4. Klick auf `nav-pronunciation` → Prüfung: `pronunciation-view` sichtbar
5. Klick auf `nav-monitoring` → Prüfung: `monitoring-view` sichtbar
6. Klick auf `nav-settings` → Prüfung: `settings-view` sichtbar

**Erwartetes Ergebnis:**
- Jeder Button navigiert zur korrekten View
- View wechselt sofort (max 3s Timeout)

---

## Test 3: Keyboard-Shortcuts Ctrl+1-6

**Funktion:** Prüft Navigation via Tastatur

**Schritte:**
1. `Ctrl+1` drücken → Prüfung: `main-view` sichtbar
2. `Ctrl+2` drücken → Prüfung: `import-view` sichtbar
3. `Ctrl+3` drücken → Prüfung: `speakers-view` sichtbar
4. `Ctrl+4` drücken → Prüfung: `pronunciation-view` sichtbar
5. `Ctrl+5` drücken → Prüfung: `monitoring-view` sichtbar
6. `Ctrl+6` drücken → Prüfung: `settings-view` sichtbar

**Erwartetes Ergebnis:**
- Alle Shortcuts funktionieren
- Shortcuts entsprechen der Button-Reihenfolge

---

## Test 4: Zurück-Navigation mit Ctrl+[

**Funktion:** Prüft "Go Back" Shortcut

**Schritte:**
1. Zu Main View navigieren (`nav-main` klicken)
2. Prüfung: `main-view` sichtbar
3. Zu Settings View navigieren (`nav-settings` klicken)
4. Prüfung: `settings-view` sichtbar
5. `Ctrl+[` drücken (BracketLeft)
6. Prüfung: `main-view` wieder sichtbar

**Erwartetes Ergebnis:**
- Shortcut navigiert zur vorherigen View
- Navigation-History wird korrekt verwaltet

---

## Test 5: Sidebar-Toggle mit Ctrl+B

**Funktion:** Prüft Ein-/Ausblenden der Project-Sidebar

**Schritte:**
1. Zu Main View navigieren (hat Sidebar)
2. Prüfung: `main-view` sichtbar
3. Aktuellen Sidebar-Zustand merken (`project-sidebar` sichtbar?)
4. `Ctrl+B` drücken
5. 500ms warten (Animation)
6. Neuen Sidebar-Zustand prüfen

**Erwartetes Ergebnis:**
- Sidebar-Zustand wechselt (visible ↔ hidden)
- Toggle funktioniert in beide Richtungen
