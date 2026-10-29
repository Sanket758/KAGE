//! Optional file logging for diagnosing Windows (and other) issues.
//!
//! Enabled with `--debug-log`. Writes timestamped lines to a log file so a
//! user can share it without a console (the app has no stdout on Windows).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static STATE: Mutex<Option<FileState>> = Mutex::new(None);

struct FileState {
    file: fs::File,
    path: PathBuf,
}

pub fn init(enabled: bool) {
    if !enabled {
        return;
    }
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) {
        let mut state = STATE.lock().expect("debug log mutex");
        *state = Some(FileState { file, path });
        log("debug logging enabled");
    }
}

pub fn is_enabled() -> bool {
    STATE.lock().expect("debug log mutex").is_some()
}

pub fn path() -> Option<PathBuf> {
    STATE.lock().expect("debug log mutex").as_ref().map(|s| s.path.clone())
}

pub fn log(message: &str) {
    if let Ok(mut guard) = STATE.lock() {
        if let Some(state) = guard.as_mut() {
            let now = chrono_free_timestamp();
            let _ = writeln!(state.file, "[{}] {}", now, message);
            let _ = state.file.flush();
        }
    }
}

fn log_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(temp) = std::env::var("TEMP") {
            return Path::new(&temp).join("kage-debug.log");
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            return Path::new(&local).join("kage").join("kage-debug.log");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(runtime) = std::env::var("XDG_RUNTIME_DIR") {
            return Path::new(&runtime).join("kage").join("kage-debug.log");
        }
    }
    std::env::temp_dir().join("kage-debug.log")
}

// Avoid pulling in chrono: format a coarse UTC-ish timestamp from SystemTime.
fn chrono_free_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}