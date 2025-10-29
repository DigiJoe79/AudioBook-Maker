// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

pub mod commands;
pub mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // Initialize app state
            let state = AppState::new();
            app.manage(state);

            // Configure window (will be shown by frontend when ready)
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                // Open devtools in debug mode
                window.open_devtools();
            }

            // Don't set initial theme - let WebView detect system theme
            // Frontend will set theme based on user settings via set_theme()
            // Window will be shown by frontend via show_main_window command

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::check_backend_health,
            commands::open_project_file,
            commands::save_project_file,
            commands::export_audio,
            commands::get_app_info,
            commands::show_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}