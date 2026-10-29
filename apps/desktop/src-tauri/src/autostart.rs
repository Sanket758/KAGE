//! Removes the login autostart entry older KAGE versions created.
//!
//! KAGE is now started by the OpenCode plugin and exits with its last client,
//! so it must never run at login.

#[cfg(unix)]
use crate::settings;
#[cfg(unix)]
use std::fs;
#[cfg(unix)]
use std::path::Path;

#[cfg(unix)]
pub fn remove_legacy_autostart() {
    let primary = settings::config_home().join("autostart").join("kage.desktop");
    remove_legacy_autostart_at(&primary);
    // The first installer ignored XDG_CONFIG_HOME and always wrote here.
    if let Some(home) = std::env::var_os("HOME") {
        let fallback = Path::new(&home)
            .join(".config")
            .join("autostart")
            .join("kage.desktop");
        if fallback != primary {
            remove_legacy_autostart_at(&fallback);
        }
    }
}

#[cfg(unix)]
fn remove_legacy_autostart_at(path: &Path) {
    let Ok(contents) = fs::read_to_string(path) else {
        return;
    };
    // Only remove a file that is clearly the entry we wrote; leave unrelated
    // desktop entries alone even if they share the directory.
    if contents.contains("KAGE") {
        let _ = fs::remove_file(path);
    }
}

#[cfg(windows)]
pub fn remove_legacy_autostart() {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(run) = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_SET_VALUE,
    ) {
        let _ = run.delete_value("KAGE");
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn removes_kage_entry_and_keeps_unrelated_files() {
        let dir = std::env::temp_dir().join(format!(
            "kage-autostart-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        let autostart = dir.join("autostart");
        fs::create_dir_all(&autostart).unwrap();

        let kage = autostart.join("kage.desktop");
        fs::write(&kage, "[Desktop Entry]\nName=KAGE\nExec=/usr/bin/kage\n").unwrap();
        remove_legacy_autostart_at(&kage);
        assert!(!kage.exists());

        let other = autostart.join("other.desktop");
        fs::write(&other, "[Desktop Entry]\nName=Other\n").unwrap();
        remove_legacy_autostart_at(&other);
        assert!(other.exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
