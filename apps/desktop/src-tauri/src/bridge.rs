//! Local-only bridge between the OpenCode plugin and the companion window.
//!
//! The plugin connects to a Unix domain socket in the user's runtime directory
//! (Linux) or to a loopback TCP port published in a file (Windows) and
//! authenticates with a random token that this process creates. Every frame is
//! size limited, JSON validated and rate limited.

use serde_json::Value;
use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};
#[cfg(windows)]
use std::net::{TcpListener, TcpStream};

pub const PROTOCOL_VERSION: u64 = 1;
pub const MAX_FRAME_BYTES: usize = 8192;
const MAX_CLIENTS: usize = 8;
const MAX_EVENTS_PER_SECOND: u32 = 200;

pub const SUPPORTED_EVENT_TYPES: &[&str] = &[
    "session_active",
    "session_idle",
    "session_error",
    "session_completed",
    "tool_started",
    "tool_finished",
    "permission_requested",
    "permission_resolved",
    "file_edited",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BridgeStatus {
    Connecting,
    Connected,
    Disconnected,
}

impl BridgeStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            BridgeStatus::Connecting => "connecting",
            BridgeStatus::Connected => "connected",
            BridgeStatus::Disconnected => "disconnected",
        }
    }

    fn code(self) -> u8 {
        match self {
            BridgeStatus::Connecting => 0,
            BridgeStatus::Connected => 1,
            BridgeStatus::Disconnected => 2,
        }
    }

    fn from_code(value: u8) -> Self {
        match value {
            1 => BridgeStatus::Connected,
            2 => BridgeStatus::Disconnected,
            _ => BridgeStatus::Connecting,
        }
    }
}

/// Thread-safe status shared with Tauri commands.
#[derive(Clone)]
pub struct StatusHandle(Arc<AtomicU8>);

impl StatusHandle {
    pub fn new() -> Self {
        Self(Arc::new(AtomicU8::new(BridgeStatus::Connecting.code())))
    }

    pub fn get(&self) -> BridgeStatus {
        BridgeStatus::from_code(self.0.load(Ordering::SeqCst))
    }

    fn set(&self, status: BridgeStatus) -> bool {
        let previous = self.0.swap(status.code(), Ordering::SeqCst);
        previous != status.code()
    }
}

impl Default for StatusHandle {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct BridgePaths {
    pub runtime_dir: PathBuf,
    /// Unix: the socket file path. Windows: the path of the port file that
    /// publishes the loopback TCP port of the running companion.
    pub socket_path: PathBuf,
    pub token_path: PathBuf,
}

/// Must mirror `resolveBridgePaths` in the plugin.
pub fn resolve_bridge_paths() -> BridgePaths {
    if let Ok(override_path) = env::var("KAGE_SOCKET_PATH") {
        let socket_path = PathBuf::from(&override_path);
        let runtime_dir = socket_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("/tmp"));
        let token_path = env::var("KAGE_TOKEN_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| runtime_dir.join("token"));
        return BridgePaths {
            runtime_dir,
            socket_path,
            token_path,
        };
    }

    #[cfg(unix)]
    {
        let uid = unsafe { libc::getuid() };
        let base = env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
        let runtime_dir = Path::new(&base).join("kage");
        let default_socket = runtime_dir.join("kage.sock");
        let socket_path = if default_socket.to_string_lossy().len() <= 100 {
            default_socket
        } else {
            PathBuf::from(format!("/tmp/kage-{uid}.sock"))
        };
        BridgePaths {
            runtime_dir,
            socket_path,
            token_path: Path::new(&base).join("kage").join("token"),
        }
    }

    #[cfg(windows)]
    {
        let base = env::var("LOCALAPPDATA").unwrap_or_else(|_| {
            env::var("USERPROFILE").unwrap_or_else(|_| r"C:\Users\Public".to_string())
        });
        let runtime_dir = Path::new(&base).join("kage");
        BridgePaths {
            runtime_dir: runtime_dir.clone(),
            socket_path: runtime_dir.join("kage.port"),
            token_path: runtime_dir.join("token"),
        }
    }
}

/// Client connection type: Unix domain socket on Linux, loopback TCP on
/// Windows. The TCP port is ephemeral (published in the port file) and every
/// client must still authenticate with the per-run token, so the security
/// model matches the socket's 0600 file permissions.
#[cfg(unix)]
pub type ClientStream = UnixStream;
#[cfg(windows)]
pub type ClientStream = TcpStream;

/// Streams that can duplicate their handle; `handle_client` reads and writes
/// concurrently and needs two handles to one connection.
trait TryCloneStream: Read + Write + Send + 'static {
    fn try_clone_stream(&self) -> io::Result<Self>
    where
        Self: Sized;
}

#[cfg(unix)]
impl TryCloneStream for UnixStream {
    fn try_clone_stream(&self) -> io::Result<Self> {
        UnixStream::try_clone(self)
    }
}

#[cfg(windows)]
impl TryCloneStream for TcpStream {
    fn try_clone_stream(&self) -> io::Result<Self> {
        TcpStream::try_clone(self)
    }
}

/// Listeners whose accept yields a client stream of the right platform type.
trait ListenerLike {
    type Stream: TryCloneStream;
    fn accept_stream(&self) -> io::Result<Self::Stream>;
}

#[cfg(unix)]
impl ListenerLike for UnixListener {
    type Stream = UnixStream;
    fn accept_stream(&self) -> io::Result<UnixStream> {
        self.accept().map(|(stream, _)| stream)
    }
}

#[cfg(windows)]
impl ListenerLike for TcpListener {
    type Stream = TcpStream;
    fn accept_stream(&self) -> io::Result<TcpStream> {
        self.accept().map(|(stream, _)| stream)
    }
}

#[cfg(windows)]
fn read_endpoint_port(paths: &BridgePaths) -> io::Result<u16> {
    let text = fs::read_to_string(&paths.socket_path)?;
    text.trim()
        .parse::<u16>()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid port file"))
}

/// Connects to the bridge endpoint of a running companion.
fn connect_endpoint(paths: &BridgePaths) -> io::Result<ClientStream> {
    #[cfg(unix)]
    {
        UnixStream::connect(&paths.socket_path)
    }
    #[cfg(windows)]
    {
        let port = read_endpoint_port(paths)?;
        TcpStream::connect(("127.0.0.1", port))
    }
}

#[derive(Debug, PartialEq)]
pub enum ClientFrame {
    Hello { version: u64, token: String },
    Event(Value),
    Control { action: String },
}

pub fn parse_frame(line: &str) -> Result<ClientFrame, &'static str> {
    let value: Value = serde_json::from_str(line.trim()).map_err(|_| "invalid json")?;
    let object = value.as_object().ok_or("frame is not an object")?;
    match object.get("type").and_then(Value::as_str) {
        Some("hello") => {
            let version = object
                .get("version")
                .and_then(Value::as_u64)
                .ok_or("invalid protocol version")?;
            if version != PROTOCOL_VERSION {
                return Err("unsupported protocol version");
            }
            let token = object
                .get("token")
                .and_then(Value::as_str)
                .ok_or("missing token")?;
            if token.len() < 16 || token.len() > 256 {
                return Err("invalid token length");
            }
            Ok(ClientFrame::Hello {
                version,
                token: token.to_string(),
            })
        }
        Some("event") => {
            let event = object.get("event").ok_or("missing event")?;
            validate_event(event)?;
            Ok(ClientFrame::Event(event.clone()))
        }
        Some("control") => {
            let action = object
                .get("action")
                .and_then(Value::as_str)
                .ok_or("missing control action")?;
            if action != "show" {
                return Err("unsupported control action");
            }
            Ok(ClientFrame::Control {
                action: action.to_string(),
            })
        }
        _ => Err("unknown message type"),
    }
}

fn validate_event(event: &Value) -> Result<(), &'static str> {
    let object = event.as_object().ok_or("event is not an object")?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or("missing event type")?;
    if !SUPPORTED_EVENT_TYPES.contains(&kind) {
        return Err("unsupported event type");
    }
    let timestamp = object
        .get("timestamp")
        .and_then(Value::as_f64)
        .ok_or("invalid timestamp")?;
    if !timestamp.is_finite() || timestamp <= 0.0 {
        return Err("invalid timestamp");
    }
    if let Some(session) = object.get("sessionId") {
        let text = session.as_str().ok_or("invalid sessionId")?;
        if text.is_empty() || text.len() > 128 {
            return Err("invalid sessionId");
        }
    }
    if let Some(metadata) = object.get("metadata") {
        let map = metadata.as_object().ok_or("invalid metadata")?;
        for (key, value) in map {
            if !["toolName", "status", "detail", "directory", "project"].contains(&key.as_str()) {
                return Err("unknown metadata field");
            }
            let text = value.as_str().ok_or("invalid metadata value")?;
            if text.len() > 512 {
                return Err("metadata value too long");
            }
        }
    }
    Ok(())
}

fn read_frame<R: BufRead>(reader: &mut R) -> io::Result<Option<String>> {
    let mut buffer = Vec::new();
    let read = reader
        .by_ref()
        .take(MAX_FRAME_BYTES as u64 + 1)
        .read_until(b'\n', &mut buffer)?;
    if read == 0 {
        return Ok(None);
    }
    if buffer.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large"));
    }
    String::from_utf8(buffer)
        .map(Some)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid utf-8"))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut difference = 0u8;
    for (left, right) in a.iter().zip(b.iter()) {
        difference |= left ^ right;
    }
    difference == 0
}

fn generate_token() -> io::Result<String> {
    let mut bytes = [0u8; 32];
    #[cfg(unix)]
    fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    #[cfg(windows)]
    getrandom::getrandom(&mut bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::Other, "system RNG failed"))?;
    let mut token = String::with_capacity(64);
    for byte in bytes {
        token.push_str(&format!("{byte:02x}"));
    }
    Ok(token)
}

fn prepare(paths: &BridgePaths) -> io::Result<String> {
    fs::create_dir_all(&paths.runtime_dir)?;
    #[cfg(unix)]
    {
        let _ = fs::set_permissions(&paths.runtime_dir, fs::Permissions::from_mode(0o700));
        if let Some(parent) = paths.token_path.parent() {
            fs::create_dir_all(parent)?;
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
    }
    #[cfg(windows)]
    if let Some(parent) = paths.token_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let token = generate_token()?;
    let temporary = paths.token_path.with_extension("tmp");
    fs::write(&temporary, token.as_bytes())?;
    #[cfg(unix)]
    fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
    fs::rename(&temporary, &paths.token_path)?;

    #[cfg(unix)]
    if paths.socket_path.exists() {
        let _ = fs::remove_file(&paths.socket_path);
    }
    Ok(token)
}

pub type EventSink = Arc<dyn Fn(Value) + Send + Sync>;
pub type StatusSink = Arc<dyn Fn(BridgeStatus) + Send + Sync>;
pub type ShowSink = Arc<dyn Fn() + Send + Sync>;

/// Asks an already running companion to show its window.
///
/// Used when the user launches KAGE again after hiding it. Returns false when
/// no companion is listening or authentication fails.
pub fn request_show(paths: &BridgePaths) -> bool {
    let token = match fs::read_to_string(&paths.token_path) {
        Ok(token) => token.trim().to_string(),
        Err(_) => return false,
    };
    if token.len() < 16 || token.len() > 256 {
        return false;
    }
    let mut stream = match connect_endpoint(paths) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));

    let hello = serde_json::json!({
        "type": "hello",
        "version": PROTOCOL_VERSION,
        "token": token,
    })
    .to_string();
    if stream
        .write_all(format!("{hello}\n{{\"type\":\"control\",\"action\":\"show\"}}\n").as_bytes())
        .is_err()
    {
        return false;
    }
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    matches!(reader.read_line(&mut line), Ok(read) if read > 0 && line.contains("welcome"))
}

pub struct Bridge {
    stop: Arc<AtomicBool>,
    paths: BridgePaths,
    thread: Option<JoinHandle<()>>,
    clients: Arc<AtomicUsize>,
}

impl Bridge {
    /// Number of currently authenticated plugin clients. The managed lifecycle
    /// watches this to exit when OpenCode is no longer attached.
    pub fn clients(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.clients)
    }

    pub fn stop(&mut self) {
        if self.stop.swap(true, Ordering::SeqCst) {
            return;
        }
        // Unblocks the accept loop so the listener thread can observe the flag.
        let _ = connect_endpoint(&self.paths);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
        #[cfg(unix)]
        let _ = fs::remove_file(&self.paths.socket_path);
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn start(
    paths: BridgePaths,
    events: EventSink,
    status_sink: StatusSink,
    show_sink: ShowSink,
    status: StatusHandle,
) -> io::Result<Bridge> {
    let token = Arc::new(prepare(&paths)?);

    #[cfg(unix)]
    let listener = {
        let listener = UnixListener::bind(&paths.socket_path)?;
        fs::set_permissions(&paths.socket_path, fs::Permissions::from_mode(0o600))?;
        listener
    };
    #[cfg(windows)]
    let listener = {
        // Bind loopback only, on an ephemeral port, and publish it for the
        // plugin; authentication still requires the per-run token file.
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let port = listener.local_addr()?.port();
        fs::write(&paths.socket_path, format!("{port}\n"))?;
        listener
    };

    let stop = Arc::new(AtomicBool::new(false));
    let clients = Arc::new(AtomicUsize::new(0));
    status.set(BridgeStatus::Connecting);
    status_sink(BridgeStatus::Connecting);

    let thread = {
        let stop = Arc::clone(&stop);
        #[cfg(unix)]
        let socket_path = paths.socket_path.clone();
        let events = Arc::clone(&events);
        let status_sink = Arc::clone(&status_sink);
        let show_sink = Arc::clone(&show_sink);
        let status = status.clone();
        let clients = Arc::clone(&clients);
        thread::Builder::new()
            .name("kage-bridge".to_string())
            .spawn(move || {
                loop {
                    match listener.accept_stream() {
                        Ok(stream) => {
                            if stop.load(Ordering::SeqCst) {
                                break;
                            }
                            if clients.load(Ordering::SeqCst) >= MAX_CLIENTS {
                                let _ = stream.shutdown(std::net::Shutdown::Both);
                                continue;
                            }
                            let token = Arc::clone(&token);
                            let events = Arc::clone(&events);
                            let status_sink = Arc::clone(&status_sink);
                            let show_sink = Arc::clone(&show_sink);
                            let status = status.clone();
                            let clients = Arc::clone(&clients);
                            let _ = thread::Builder::new()
                                .name("kage-client".to_string())
                                .spawn(move || {
                                    let _ = handle_client(
                                        stream,
                                        &token,
                                        &events,
                                        &status,
                                        &status_sink,
                                        &show_sink,
                                        &clients,
                                    );
                                });
                        }
                        Err(error) => {
                            if stop.load(Ordering::SeqCst) {
                                break;
                            }
                            if error.kind() == io::ErrorKind::Interrupted {
                                continue;
                            }
                            // Transient accept failures must not spin.
                            thread::sleep(Duration::from_millis(200));
                        }
                    }
                }
                #[cfg(unix)]
                let _ = fs::remove_file(&socket_path);
            })?
    };

    Ok(Bridge {
        stop,
        paths,
        thread: Some(thread),
        clients,
    })
}

fn handle_client<S: TryCloneStream>(
    mut stream: S,
    token: &str,
    events: &EventSink,
    status: &StatusHandle,
    status_sink: &StatusSink,
    show_sink: &ShowSink,
    clients: &AtomicUsize,
) -> io::Result<()> {
    let read_stream = stream.try_clone_stream()?;
    let mut reader = BufReader::new(read_stream);

    let first = match read_frame(&mut reader)? {
        Some(line) => line,
        None => return Ok(()),
    };

    let authorized = match parse_frame(&first) {
        Ok(ClientFrame::Hello {
            token: provided, ..
        }) => constant_time_eq(provided.as_bytes(), token.as_bytes()),
        _ => false,
    };
    if !authorized {
        let _ = stream.write_all(b"{\"type\":\"error\",\"reason\":\"unauthorized\"}\n");
        let _ = stream.flush();
        return Ok(());
    }

    // Mark the client connected BEFORE welcoming it: a client that has read
    // its welcome must observe Connected status deterministically (the
    // Windows scheduler exposed this ordering race).
    let already_connected = clients.fetch_add(1, Ordering::SeqCst);
    if already_connected == 0 && status.set(BridgeStatus::Connected) {
        status_sink(BridgeStatus::Connected);
    }
    stream.write_all(
        format!("{{\"type\":\"welcome\",\"version\":{PROTOCOL_VERSION}}}\n").as_bytes(),
    )?;
    stream.flush()?;

    let mut window = Instant::now();
    let mut count = 0u32;

    loop {
        if window.elapsed() >= Duration::from_secs(1) {
            window = Instant::now();
            count = 0;
        }
        let line = match read_frame(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        if count >= MAX_EVENTS_PER_SECOND {
            let _ = stream.write_all(b"{\"type\":\"error\",\"reason\":\"rate limited\"}\n");
            break;
        }
        match parse_frame(&line) {
            Ok(ClientFrame::Event(event)) => {
                count += 1;
                events(event);
            }
            Ok(ClientFrame::Hello { .. }) => {}
            Ok(ClientFrame::Control { action }) => {
                if action == "show" {
                    show_sink();
                }
            }
            Err(_) => {
                let _ = stream.write_all(b"{\"type\":\"error\",\"reason\":\"invalid frame\"}\n");
                break;
            }
        }
    }

    let remaining = clients.fetch_sub(1, Ordering::SeqCst).saturating_sub(1);
    if remaining == 0 && status.set(BridgeStatus::Disconnected) {
        status_sink(BridgeStatus::Disconnected);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_hello_and_valid_events() {
        let hello = format!(r#"{{"type":"hello","version":1,"token":"{}"}}"#, "a".repeat(32));
        assert!(matches!(parse_frame(&hello), Ok(ClientFrame::Hello { .. })));

        let event = r#"{"type":"event","event":{"type":"tool_started","sessionId":"ses_1","timestamp":1700000000000,"metadata":{"toolName":"edit"}}}"#;
        assert!(matches!(parse_frame(event), Ok(ClientFrame::Event(_))));
    }

    #[test]
    fn rejects_oversized_or_invalid_events() {
        assert!(parse_frame("not json").is_err());
        assert!(parse_frame(r#"{"type":"hello","version":2,"token":"aaaaaaaaaaaaaaaa"}"#).is_err());
        assert!(parse_frame(
            r#"{"type":"event","event":{"type":"unknown","timestamp":1700000000000}}"#
        )
        .is_err());
        assert!(parse_frame(
            r#"{"type":"event","event":{"type":"tool_started","sessionId":42,"timestamp":1700000000000}}"#
        )
        .is_err());
        assert!(parse_frame(
            r#"{"type":"event","event":{"type":"tool_started","timestamp":1700000000000,"metadata":{"args":{}}}}"#
        )
        .is_err());
        assert!(parse_frame(
            r#"{"type":"event","event":{"type":"tool_started","timestamp":1700000000000,"metadata":{"detail":"ok","extra":"no"}}}"#
        )
        .is_err());
    }

    #[test]
    fn parses_show_control_and_rejects_unknown_actions() {
        assert_eq!(
            parse_frame(r#"{"type":"control","action":"show"}"#),
            Ok(ClientFrame::Control {
                action: "show".to_string()
            })
        );
        assert!(parse_frame(r#"{"type":"control","action":"shutdown"}"#).is_err());
        assert!(parse_frame(r#"{"type":"control"}"#).is_err());
    }

    #[test]
    fn token_comparison_is_exact() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    #[test]
    fn bridge_authenticates_and_streams_events() {
        let dir = std::env::temp_dir().join(format!(
            "kage-bridge-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let paths = BridgePaths {
            runtime_dir: dir.clone(),
            socket_path: dir.join("kage.sock"),
            token_path: dir.join("token"),
        };

        let received = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
        let sink_received = Arc::clone(&received);
        let events: EventSink = Arc::new(move |event: Value| {
            sink_received.lock().unwrap().push(event);
        });
        let statuses = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink_statuses = Arc::clone(&statuses);
        let status_sink: StatusSink = Arc::new(move |status: BridgeStatus| {
            sink_statuses.lock().unwrap().push(status);
        });

        let status = StatusHandle::new();
        let shown = Arc::new(AtomicUsize::new(0));
        let shown_sink = Arc::clone(&shown);
        let show_sink: ShowSink = Arc::new(move || {
            shown_sink.fetch_add(1, Ordering::SeqCst);
        });
        let mut bridge =
            start(paths.clone(), events, status_sink, show_sink, status.clone()).unwrap();
        assert_eq!(status.get(), BridgeStatus::Connecting);

        let token = fs::read_to_string(&paths.token_path).unwrap();
        assert_eq!(token.len(), 64);

        let stream = connect_endpoint(&paths).unwrap();
        let mut writer = stream.try_clone_stream().unwrap();
        let mut reader = BufReader::new(stream);
        let hello = format!(
            "{{\"type\":\"hello\",\"version\":1,\"token\":\"{token}\"}}\n"
        );
        writer.write_all(hello.as_bytes()).unwrap();
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.contains("welcome"));
        assert_eq!(status.get(), BridgeStatus::Connected);
        assert_eq!(bridge.clients().load(Ordering::SeqCst), 1);

        let control = r#"{"type":"control","action":"show"}"#;
        writer.write_all(format!("{control}\n").as_bytes()).unwrap();
        let event = r#"{"type":"event","event":{"type":"session_active","sessionId":"ses_1","timestamp":1700000000000}}"#;
        writer.write_all(format!("{event}\n").as_bytes()).unwrap();

        let deadline = Instant::now() + Duration::from_secs(2);
        while received.lock().unwrap().is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(received.lock().unwrap().len(), 1);
        assert_eq!(
            received.lock().unwrap()[0].get("type").and_then(Value::as_str),
            Some("session_active")
        );
        assert_eq!(shown.load(Ordering::SeqCst), 1, "control frame shows the window");

        drop(writer);
        drop(reader);
        let deadline = Instant::now() + Duration::from_secs(2);
        while status.get() != BridgeStatus::Disconnected && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(status.get(), BridgeStatus::Disconnected);
        assert_eq!(bridge.clients().load(Ordering::SeqCst), 0);

        bridge.stop();
        // Only Unix removes the endpoint file on stop; the Windows port file
        // is an ordinary file that the next run overwrites.
        #[cfg(unix)]
        assert!(!paths.socket_path.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unauthorized_clients() {
        let dir = std::env::temp_dir().join(format!(
            "kage-bridge-auth-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let paths = BridgePaths {
            runtime_dir: dir.clone(),
            socket_path: dir.join("kage.sock"),
            token_path: dir.join("token"),
        };
        let events: EventSink = Arc::new(|_| {});
        let status_sink: StatusSink = Arc::new(|_| {});
        let show_sink: ShowSink = Arc::new(|| {});
        let status = StatusHandle::new();
        let mut bridge =
            start(paths.clone(), events, status_sink, show_sink, status.clone()).unwrap();

        let stream = connect_endpoint(&paths).unwrap();
        let mut writer = stream.try_clone_stream().unwrap();
        let mut reader = BufReader::new(stream);
        writer
            .write_all(b"{\"type\":\"hello\",\"version\":1,\"token\":\"wrong-token-wrong-token\"}\n")
            .unwrap();
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.contains("unauthorized"));
        thread::sleep(Duration::from_millis(50));
        assert_eq!(status.get(), BridgeStatus::Connecting);

        bridge.stop();
        let _ = fs::remove_dir_all(&dir);
    }
}
