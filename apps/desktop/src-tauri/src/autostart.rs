use crate::settings;
use std::env;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

pub fn desktop_entry_path() -> PathBuf {
    settings::config_home().join("autostart").join("kage.desktop")
}

pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    set_autostart_at(&desktop_entry_path(), enabled, &executable)
}

fn set_autostart_at(path: &Path, enabled: bool, executable: &Path) -> Result<(), String> {
    if !enabled {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    }

    let parent = path.parent().ok_or("autostart path has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));

    let quoted = executable.to_string_lossy().replace('"', "\\\"");
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=KAGE\nComment=OpenCode companion\nExec=\"{quoted}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
    );
    fs::write(path, entry).map_err(|error| error.to_string())?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_removes_desktop_entry() {
        let dir = std::env::temp_dir().join(format!(
            "kage-autostart-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("autostart/kage.desktop");
        let executable = Path::new("/usr/bin/kage companion");

        set_autostart_at(&path, true, executable).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        assert!(contents.contains("Exec=\"/usr/bin/kage companion\""));
        assert!(contents.contains("Type=Application"));

        set_autostart_at(&path, false, executable).unwrap();
        assert!(!path.exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
