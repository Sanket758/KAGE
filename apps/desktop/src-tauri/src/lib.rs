mod autostart;
mod bridge;
mod settings;

use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use tauri::{Emitter, Manager, PhysicalPosition};

struct AppState {
    status: bridge::StatusHandle,
    bridge: Mutex<Option<bridge::Bridge>>,
    move_mode: AtomicBool,
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
fn set_autostart(enabled: bool) -> Result<(), String> {
    autostart::set_autostart(enabled)
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
        let _ = window.set_ignore_cursor_events(true);
        save_position(&window);
    }
    let _ = app.emit("kage://move-mode", enabled);
    enabled
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = bridge::resolve_bridge_paths();
    // Launching KAGE again after hiding it reopens the existing companion.
    if bridge::request_show(&paths) {
        return;
    }

    let builder = tauri::Builder::default()
        .manage(AppState {
            status: bridge::StatusHandle::new(),
            bridge: Mutex::new(None),
            move_mode: AtomicBool::new(false),
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
            set_autostart,
            set_move_mode,
            quit_app
        ])
        .setup(|app| {
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
                    *app
                        .state::<AppState>()
                        .bridge
                        .lock()
                        .expect("bridge mutex poisoned") = Some(bridge);
                }
                Err(error) => {
                    eprintln!("kage: could not start the local bridge: {error}");
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                // The mascot is a passive overlay: no focus, no pointer input,
                // and a truly transparent window/webview background.
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                // Config sets shadow:false too; reassert at runtime so no
                // compositor/CDS shadow rectangle shows around the sprite.
                let _ = window.set_shadow(false);
                let _ = window.set_focusable(false);
                let _ = window.show();
                // The GdkWindow only exists once the window is realized by
                // show(); tao unwraps it when applying the input shape, so
                // this must come after show(), never before.
                let _ = window.set_ignore_cursor_events(true);
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
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut guard) = handle.state::<AppState>().bridge.lock() {
                    if let Some(bridge) = guard.as_mut() {
                        bridge.stop();
                    }
                }
            }
        });
}
