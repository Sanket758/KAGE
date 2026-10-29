mod autostart;
mod bridge;
mod instance;
mod settings;

use std::sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, PhysicalPosition};

struct AppState {
    status: bridge::StatusHandle,
    bridge: Mutex<Option<bridge::Bridge>>,
    move_mode: AtomicBool,
    last_position_save: Mutex<std::time::Instant>,
}

#[tauri::command]
fn get_bridge_status(state: tauri::State<'_, AppState>) -> String {
    state.status.get().as_str().to_string()
}

#[tauri::command]
fn get_settings() -> serde_json::Value {
    settings::read_settings()
}

#[tauri::command]
fn save_settings(settings: serde_json::Value) -> Result<(), String> {
    settings::write_settings(&settings)
}

#[tauri::command]
fn set_move_mode(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    enabled: bool,
) -> bool {
    state.move_mode.store(enabled, Ordering::SeqCst);
    apply_move_mode(&app, enabled)
}

fn save_position(window: &tauri::WebviewWindow) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let mut value = settings::read_settings();
    if !value.is_object() {
        value = serde_json::json!({});
    }
    value["position"] = serde_json::json!({ "x": position.x, "y": position.y });
    if let Err(error) = settings::write_settings(&value) {
        eprintln!("kage: could not save window position: {error}");
    }
}

/// Move mode makes the otherwise click-through overlay interactive so it can
/// be dragged with the mouse. The whole window rectangle captures input while
/// active, so it must stay a short-lived, user-invoked state.
fn apply_move_mode(app: &tauri::AppHandle, enabled: bool) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    if enabled {
        let _ = window.set_focusable(true);
        let _ = window.set_ignore_cursor_events(false);
        let _ = window.set_focus();
    } else {
        let _ = window.set_focusable(false);
        sprite_input_shape(&window);
    }
    let _ = app.emit("kage://move-mode", enabled);
    enabled
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Strip everything the GTK stack paints around/behind the webview: the
/// theme's opaque window background and the decorated "card" frame (rounded
/// corners + border) that shows up as a box around the sprite.
#[cfg(target_os = "linux")]
fn apply_gtk_transparency(window: &tauri::WebviewWindow) {
    use gtk::prelude::*;

    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };
    gtk_window.set_decorated(false);
    gtk_window.set_app_paintable(true);
    if let Some(screen) = gtk::prelude::WidgetExt::screen(&gtk_window) {
        if let Some(visual) = screen.rgba_visual() {
            gtk_window.set_visual(Some(&visual));
        }
        let provider = gtk::CssProvider::new();
        let _ = provider.load_from_data(
            b"window { background: transparent; }\n
              decoration, .decoration, .background {
                  border: none;
                  box-shadow: none;
                  border-radius: 0;
                  background: transparent;
              }",
        );
        gtk::StyleContext::add_provider_for_screen(
            &screen,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
}

#[cfg(not(target_os = "linux"))]
fn apply_gtk_transparency(_window: &tauri::WebviewWindow) {}

/// Limit the window's input region to the sprite's square, centered like the
/// renderer draws it (fit = min(w,h) * 0.94 * scale). Everywhere else the
/// pointer passes through to the apps below. This is what makes the mascot
/// grabbable on Wayland — global shortcuts are unreliable there, but a hit
/// region plus `startDragging()` is not.
#[cfg(target_os = "linux")]
fn sprite_input_shape(window: &tauri::WebviewWindow) {
    use gtk::prelude::*;

    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };
    let Some(gdk_window) = gtk::prelude::WidgetExt::window(&gtk_window) else {
        return;
    };
    let (width, height) = (gdk_window.width(), gdk_window.height());
    if width <= 0 || height <= 0 {
        return;
    }
    let scale = settings::read_settings()
        .get("scale")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(1.0)
        .clamp(0.75, 2.0);
    let side = ((width.min(height) as f64) * 0.94 * scale).round() as i32;
    let side = side.min(width).min(height);
    let rect = cairo::RectangleInt::new((width - side) / 2, (height - side) / 2, side, side);
    let region = cairo::Region::create_rectangle(&rect);
    gdk_window.input_shape_combine_region(&region, 0, 0);
}

#[cfg(not(target_os = "linux"))]
fn sprite_input_shape(_window: &tauri::WebviewWindow) {}

/// Position saves are throttled because `Moved` fires at pointer frequency
/// while dragging; the final position is always saved on exit.
fn save_position_throttled(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<AppState>();
        let mut last = state.last_position_save.lock().expect("position mutex");
        if last.elapsed() < std::time::Duration::from_millis(800) {
            return;
        }
        *last = std::time::Instant::now();
        save_position(&window);
    }
}

fn position_is_visible(window: &tauri::WebviewWindow, x: i32, y: i32) -> bool {
    match window.available_monitors() {
        Ok(monitors) if !monitors.is_empty() => monitors.iter().any(|monitor| {
            let origin = monitor.position();
            let size = monitor.size();
            let width = size.width as i32;
            let height = size.height as i32;
            x >= origin.x - 80
                && x <= origin.x + width - 80
                && y >= origin.y - 20
                && y <= origin.y + height - 80
        }),
        _ => true,
    }
}

fn restore_position(app: &tauri::AppHandle) {
    let value = settings::read_settings();
    let Some(position) = value.get("position") else {
        return;
    };
    let (Some(x), Some(y)) = (
        position.get("x").and_then(serde_json::Value::as_f64),
        position.get("y").and_then(serde_json::Value::as_f64),
    ) else {
        return;
    };
    if !x.is_finite() || !y.is_finite() || x.abs() > 100_000.0 || y.abs() > 100_000.0 {
        return;
    }
    let (x, y) = (x.round() as i32, y.round() as i32);
    if let Some(window) = app.get_webview_window("main") {
        if position_is_visible(&window, x, y) {
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
}

/// A companion launched by the OpenCode plugin (`--managed`) must not outlive
/// its clients. It waits 10 s after the last client disconnects, or 60 s after
/// launch when no client ever connects, then exits. A manual launch has no
/// flag and keeps running until the user quits it.
fn watch_managed_lifecycle(app: tauri::AppHandle, clients: Arc<AtomicUsize>) {
    let _ = std::thread::Builder::new()
        .name("kage-lifecycle".to_string())
        .spawn(move || {
            let started = Instant::now();
            let mut ever_connected = false;
            let mut idle_since = started;
            loop {
                std::thread::sleep(Duration::from_secs(1));
                if clients.load(Ordering::SeqCst) > 0 {
                    ever_connected = true;
                    idle_since = Instant::now();
                } else {
                    let grace = if ever_connected {
                        Duration::from_secs(10)
                    } else {
                        Duration::from_secs(60)
                    };
                    if idle_since.elapsed() >= grace {
                        app.exit(0);
                        return;
                    }
                }
            }
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = bridge::resolve_bridge_paths();
    autostart::remove_legacy_autostart();

    // One companion per user. The guard lives until the process exits, so a
    // second launch can never create a second window even when several
    // OpenCode sessions start at once.
    let _instance = match instance::acquire(&paths.runtime_dir) {
        Ok(Some(guard)) => Some(guard),
        Ok(None) => {
            // The running instance may still be bringing its bridge up.
            for _ in 0..10 {
                if bridge::request_show(&paths) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(300));
            }
            return;
        }
        Err(error) => {
            eprintln!("kage: could not acquire the single-instance lock: {error}");
            if bridge::request_show(&paths) {
                return;
            }
            None
        }
    };
    let managed = std::env::args().any(|argument| argument == "--managed");

    let builder = tauri::Builder::default()
        .manage(AppState {
            status: bridge::StatusHandle::new(),
            bridge: Mutex::new(None),
            move_mode: AtomicBool::new(false),
            last_position_save: Mutex::new(std::time::Instant::now()),
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let state = app.state::<AppState>();
                        let next = !state.move_mode.load(Ordering::SeqCst);
                        state.move_mode.store(next, Ordering::SeqCst);
                        apply_move_mode(app, next);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_bridge_status,
            get_settings,
            save_settings,
            set_move_mode,
            quit_app
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            restore_position(&handle);

            let status_handle = app.state::<AppState>().status.clone();
            let emit_handle = handle.clone();
            let events: bridge::EventSink = Arc::new(move |event| {
                let _ = emit_handle.emit("kage://event", event);
            });
            let emit_status = handle.clone();
            let status_sink: bridge::StatusSink = Arc::new(move |status| {
                let _ = emit_status.emit("kage://status", status.as_str());
            });
            let show_app = handle.clone();
            let show_sink: bridge::ShowSink = Arc::new(move || {
                let app = show_app.clone();
                let _ = show_app.run_on_main_thread(move || {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                    }
                });
            });

            match bridge::start(paths, events, status_sink, show_sink, status_handle) {
                Ok(bridge) => {
                    let clients = bridge.clients();
                    *app
                        .state::<AppState>()
                        .bridge
                        .lock()
                        .expect("bridge mutex poisoned") = Some(bridge);
                    if managed {
                        watch_managed_lifecycle(handle.clone(), clients);
                    }
                }
                Err(error) => {
                    eprintln!("kage: could not start the local bridge: {error}");
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                // The mascot is a passive overlay: no focus, no pointer input,
                // and a truly transparent window/webview background.
                //
                // Tauri's own transparent flag is not enough on this stack:
                // the GTK window still gets the theme's opaque background and
                // the theme/compositor draws a framed "card" (rounded corners,
                // 1px border) around it. Configure the GTK window directly:
                // RGBA visual + app-paintable so the GdkWindow itself is
                // see-through, and a CSS provider that strips the decoration
                // node the COSMIC GTK theme styles.
                let _ = window.set_shadow(false);
                let _ = window.set_focusable(false);
                apply_gtk_transparency(&window);
                let _ = window.show();
                // The GdkWindow only exists once the window is realized by
                // show(); tao unwraps it when applying the input shape, so
                // this must come after show(), never before.
                let _ = window.set_ignore_cursor_events(true);
                // Then narrow the input region to the sprite itself so the
                // mascot is directly grabbable and the rest stays click-through.
                sprite_input_shape(&window);
            }

            // Ctrl+Alt+M toggles move mode so the mascot can be repositioned.
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            match "ctrl+alt+m".parse::<tauri_plugin_global_shortcut::Shortcut>() {
                Ok(shortcut) => {
                    if let Err(error) = app.global_shortcut().register(shortcut) {
                        eprintln!("kage: could not register Ctrl+Alt+M: {error}");
                    }
                }
                Err(error) => eprintln!("kage: bad shortcut definition: {error}"),
            }
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("failed to build KAGE")
        .run(|handle, event| {
            match &event {
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::Moved(_),
                    ..
                } => save_position_throttled(handle),
                tauri::RunEvent::Exit => {
                    if let Some(window) = handle.get_webview_window("main") {
                        save_position(&window);
                    }
                    if let Ok(mut guard) = handle.state::<AppState>().bridge.lock() {
                        if let Some(bridge) = guard.as_mut() {
                            bridge.stop();
                        }
                    }
                }
                _ => {}
            }
        });
}
