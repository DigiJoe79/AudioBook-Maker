# Rust Installation für Tauri

## Problem
Der Fehler `failed to run 'cargo metadata' command: program not found` bedeutet, dass Rust nicht installiert ist.

## Windows Installation

### Option 1: Rustup (Empfohlen)

1. **Lade den Rust Installer herunter:**
   - Gehe zu: https://www.rust-lang.org/tools/install
   - Lade `rustup-init.exe` herunter

2. **Führe den Installer aus:**
   - Doppelklicke auf `rustup-init.exe`
   - Wähle Option 1 (default installation)
   - Der Installer wird Rust und Cargo installieren

3. **Pfad zur System-PATH hinzufügen (automatisch):**
   - Der Installer fügt automatisch `%USERPROFILE%\.cargo\bin` zur PATH hinzu
   - Starte die Kommandozeile neu nach der Installation

### Option 2: Scoop (Alternative)

```powershell
# Wenn Scoop installiert ist:
scoop install rustup
rustup default stable
```

### Option 3: Chocolatey (Alternative)

```powershell
# Wenn Chocolatey installiert ist:
choco install rust
```

## Verifizierung

Nach der Installation, öffne ein **neues** Terminal und prüfe:

```bash
# Prüfe Rust Installation
rustc --version
# Sollte ausgeben: rustc 1.7x.x (...)

# Prüfe Cargo Installation
cargo --version
# Sollte ausgeben: cargo 1.7x.x (...)
```

## Visual Studio Build Tools (Windows)

Tauri benötigt auch die Microsoft C++ Build Tools:

1. **Lade Visual Studio Build Tools herunter:**
   - https://visualstudio.microsoft.com/visual-cpp-build-tools/

2. **Installiere mit folgenden Komponenten:**
   - MSVC v143 - VS 2022 C++ x64/x86 build tools
   - Windows 10 SDK (oder Windows 11 SDK)
   - C++ CMake tools for Windows (optional)

### Alternative: Minimale Installation

```powershell
# PowerShell als Administrator
winget install Microsoft.VisualStudio.2022.BuildTools
```

## WebView2 Runtime (Windows)

Tauri benötigt WebView2 (normalerweise bereits in Windows 10/11):

```powershell
# Prüfe ob WebView2 installiert ist
Get-AppxPackage -Name *WebView2* -AllUsers

# Falls nicht installiert, lade herunter von:
# https://developer.microsoft.com/en-us/microsoft-edge/webview2/
```

## Nach der Installation

1. **Schließe ALLE Terminal-Fenster**
2. **Öffne ein neues Terminal**
3. **Navigiere zum Frontend-Verzeichnis:**
   ```bash
   cd E:\vsCode Projects\audiobook-maker\frontend
   ```

4. **Installiere Dependencies (falls noch nicht geschehen):**
   ```bash
   npm install
   ```

5. **Starte Tauri Dev:**
   ```bash
   npm run dev:tauri
   ```

## Troubleshooting

### Fehler: "cargo not found" nach Installation

**Lösung 1:** Terminal neu starten
- Schließe alle Terminal-Fenster
- Öffne ein neues Terminal
- Versuche erneut

**Lösung 2:** PATH manuell prüfen
```powershell
# PowerShell
$env:Path -split ';' | Select-String cargo

# Sollte zeigen: C:\Users\[USERNAME]\.cargo\bin
```

**Lösung 3:** PATH manuell hinzufügen
1. Windows-Taste + X → System → Erweiterte Systemeinstellungen
2. Umgebungsvariablen → PATH bearbeiten
3. Hinzufügen: `%USERPROFILE%\.cargo\bin`
4. OK → OK → Terminal neu starten

### Fehler: "error: Microsoft Visual C++ 14.0 or greater is required"

Installiere Visual Studio Build Tools (siehe oben)

### Fehler: "could not compile"

```bash
# Cache löschen und neu kompilieren
cd frontend/src-tauri
cargo clean
cd ..
npm run dev:tauri
```

## Geschätzte Installationszeit

- Rust Installation: 2-5 Minuten
- Visual Studio Build Tools: 5-10 Minuten
- Erste Tauri Kompilierung: 3-5 Minuten

## Systemanforderungen

- Windows 10 Version 1803+ (64-bit)
- 4 GB RAM (8 GB empfohlen)
- 2 GB freier Speicherplatz
- Internetverbindung für Downloads

## Nächste Schritte

Nach erfolgreicher Installation:

1. **Backend starten (separates Terminal):**
   ```bash
   cd ..\backend
   python main.py
   ```

2. **Tauri Frontend starten:**
   ```bash
   cd frontend
   npm run dev:tauri
   ```

3. Die App sollte sich öffnen mit:
   - Tauri Window mit React App
   - Backend-Verbindung zu localhost:8765

## Alternative: Nur Frontend Development (ohne Tauri)

Falls du nur am React Frontend arbeiten möchtest ohne Tauri:

```bash
cd frontend
npm run dev
# Öffne http://localhost:5173 im Browser
```

Dies startet nur den Vite Dev Server ohne Tauri Window.