use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectData {
    pub name: String,
    pub chapters: Vec<serde_json::Value>,
    pub settings: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppInfo {
    pub version: String,
    pub name: String,
    pub platform: String,
    pub arch: String,
}

#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
pub async fn check_backend_health() -> Result<bool, String> {
    // Check if Python backend is running on port 8765
    match reqwest::get("http://127.0.0.1:8765/health").await {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false), // Backend not running, but this is not an error
    }
}

#[tauri::command]
pub async fn open_project_file() -> Result<String, String> {
    // This will be handled by the frontend using tauri-plugin-dialog
    // Returning a placeholder for now
    Ok("".to_string())
}

#[tauri::command]
pub async fn save_project_file(
    path: String,
    content: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // Save project data to file
    use std::fs;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to save project file: {}", e))?;

    // Update state with last saved path
    _state.set_last_project_path(Some(path));

    Ok(())
}

#[tauri::command]
pub async fn export_audio(
    format: String,
    path: String,
    audio_data: Vec<u8>,
) -> Result<(), String> {
    // Export audio to specified format
    use std::fs;

    // For now, just save the raw audio data
    // In production, you would convert based on format (mp3, wav, m4a, etc.)
    fs::write(&path, audio_data)
        .map_err(|e| format!("Failed to export audio: {}", e))?;

    println!("Audio exported to {} in {} format", path, format);

    Ok(())
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        name: env!("CARGO_PKG_NAME").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[tauri::command]
pub async fn show_main_window(window: tauri::Window) -> Result<(), String> {
    // Called by frontend when React is fully loaded and ready
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}