use serde_json::Value;
use std::env;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

pub const MAX_SETTINGS_BYTES: usize = 64 * 1024;

pub fn config_home() -> PathBuf {
    if let Some(dir) = env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(dir);
    }
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home).join(".config");
    }
    #[cfg(windows)]
    if let Some(dir) = env::var_os("LOCALAPPDATA") {
        return PathBuf::from(dir);
    }
    #[cfg(not(windows))]
    return PathBuf::from("/tmp").join(format!("kage-{}", unsafe { libc::getuid() }));
    #[cfg(windows)]
    return PathBuf::from(r"C:\Users\Public");
}

pub fn settings_path() -> PathBuf {
    config_home().join("kage").join("settings.json")
}

pub fn read_settings() -> Value {
    read_settings_from(&settings_path()).unwrap_or(Value::Null)
}

pub fn write_settings(value: &Value) -> Result<(), String> {
    write_settings_to(&settings_path(), value)
}

fn read_settings_from(path: &Path) -> Option<Value> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() as usize > MAX_SETTINGS_BYTES {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value.is_object().then_some(value)
}

fn write_settings_to(path: &Path, value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("settings must be a JSON object".to_string());
    }
    let serialized = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    if serialized.len() > MAX_SETTINGS_BYTES {
        return Err("settings are too large".to_string());
    }
    let parent = path.parent().ok_or("settings path has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));

    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serialized).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kage-settings-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("settings.json")
    }

    #[test]
    fn round_trips_settings() {
        let path = temp_path("roundtrip");
        let settings = json!({ "scale": 1.5, "position": { "x": 10, "y": 20 } });
        write_settings_to(&path, &settings).unwrap();
        assert_eq!(read_settings_from(&path), Some(settings));
        #[cfg(unix)]
        {
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn rejects_invalid_or_oversized_settings() {
        let path = temp_path("invalid");
        assert!(write_settings_to(&path, &json!([1, 2, 3])).is_err());
        let huge = json!({ "blob": "x".repeat(MAX_SETTINGS_BYTES + 1) });
        assert!(write_settings_to(&path, &huge).is_err());
        assert_eq!(read_settings_from(&path), None);
    }

    #[test]
    fn handles_corrupted_files() {
        let path = temp_path("corrupt");
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(read_settings_from(&path), None);
    }
}
