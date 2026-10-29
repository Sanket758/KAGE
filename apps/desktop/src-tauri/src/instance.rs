//! Single-instance guard.
//!
//! KAGE is one companion window per user, not one per OpenCode session. The
//! guard makes that an OS-level guarantee: the first process holds the lock
//! for its lifetime, later launches find it taken and forward a "show" request
//! to the running instance instead of opening a second window.

use std::io;
use std::path::Path;

#[cfg(unix)]
use std::fs::{self, File, OpenOptions};
#[cfg(unix)]
use std::os::fd::AsRawFd;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

pub struct InstanceGuard {
    #[cfg(unix)]
    _file: File,
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

/// Tries to become the single KAGE instance for this user.
///
/// Returns `Ok(None)` when another process holds the lock. The lock is
/// released automatically when the process exits or the guard is dropped.
#[cfg(unix)]
pub fn acquire(runtime_dir: &Path) -> io::Result<Option<InstanceGuard>> {
    fs::create_dir_all(runtime_dir)?;
    let path = runtime_dir.join("kage.lock");
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&path)?;
    let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));

    loop {
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result == 0 {
            return Ok(Some(InstanceGuard { _file: file }));
        }
        let error = io::Error::last_os_error();
        match error.raw_os_error() {
            Some(libc::EWOULDBLOCK) => return Ok(None),
            Some(libc::EINTR) => continue,
            _ => return Err(error),
        }
    }
}

/// Windows uses a named mutex because there is no `flock` equivalent with the
/// same crash-safe lifetime. `Local\` scopes it to the logged-in session.
#[cfg(windows)]
pub fn acquire(_runtime_dir: &Path) -> io::Result<Option<InstanceGuard>> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    let name: Vec<u16> = "Local\\KAGE-io.kage.companion\0".encode_utf16().collect();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 1, name.as_ptr()) };
    if handle.is_null() {
        return Err(io::Error::last_os_error());
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe { CloseHandle(handle) };
        return Ok(None);
    }
    Ok(Some(InstanceGuard { handle }))
}

#[cfg(windows)]
impl Drop for InstanceGuard {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.handle) };
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kage-instance-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn allows_one_guard_per_runtime_dir() {
        let dir = temp_dir("single");
        let first = acquire(&dir).unwrap().expect("first instance");
        assert!(acquire(&dir).unwrap().is_none());

        drop(first);
        assert!(acquire(&dir).unwrap().is_some());
        let _ = fs::remove_dir_all(&dir);
    }
}
