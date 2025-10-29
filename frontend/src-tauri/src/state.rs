use std::sync::Mutex;

#[derive(Debug, Default)]
pub struct AppState {
    pub backend_url: Mutex<String>,
    pub backend_running: Mutex<bool>,
    pub last_project_path: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            backend_url: Mutex::new("http://127.0.0.1:8765".to_string()),
            backend_running: Mutex::new(false),
            last_project_path: Mutex::new(None),
        }
    }

    pub fn set_backend_url(&self, url: String) {
        if let Ok(mut backend_url) = self.backend_url.lock() {
            *backend_url = url;
        }
    }

    pub fn get_backend_url(&self) -> String {
        self.backend_url.lock()
            .map(|url| url.clone())
            .unwrap_or_else(|_| "http://127.0.0.1:8765".to_string())
    }

    pub fn set_backend_running(&self, running: bool) {
        if let Ok(mut backend_running) = self.backend_running.lock() {
            *backend_running = running;
        }
    }

    pub fn is_backend_running(&self) -> bool {
        self.backend_running.lock()
            .map(|running| *running)
            .unwrap_or(false)
    }

    pub fn set_last_project_path(&self, path: Option<String>) {
        if let Ok(mut last_path) = self.last_project_path.lock() {
            *last_path = path;
        }
    }

    pub fn get_last_project_path(&self) -> Option<String> {
        self.last_project_path.lock()
            .ok()
            .and_then(|path| path.clone())
    }
}