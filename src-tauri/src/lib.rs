mod sidecar;

use sidecar::SidecarState;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn get_sidecar_port(state: tauri::State<Mutex<SidecarState>>) -> Result<u16, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.port.ok_or_else(|| "Sidecar not ready".to_string())
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(Mutex::new(SidecarState::default()))
        .invoke_handler(tauri::generate_handler![get_sidecar_port, get_platform])
        .setup(|app| {
            // Start the Bun sidecar on app setup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = sidecar::start_sidecar(&app_handle).await {
                    eprintln!("[sidecar] Failed to start: {}", e);
                }
            });

            // Setup system tray
            let show_item =
                tauri::menu::MenuItemBuilder::with_id("show", "显示小龙虾").build(app)?;
            let quit_item = tauri::menu::MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .items(&[&show_item, &quit_item])
                .build()?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .tooltip("小龙虾 — AI 助手")
                .menu(&tray_menu)
                .on_menu_event(|app_handle: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Gracefully stop sidecar on exit
                let state = app.state::<Mutex<SidecarState>>();
                if let Ok(mut guard) = state.lock() {
                    guard.stop();
                };
            }
        });
}
