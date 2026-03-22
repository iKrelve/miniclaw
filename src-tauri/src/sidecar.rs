use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use std::sync::Mutex;
use std::time::Duration;

/// State for the sidecar process lifecycle.
/// Holds the `CommandChild` so we can kill it on exit.
pub struct SidecarState {
    pub port: Option<u16>,
    child: Option<CommandChild>,
    running: bool,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            port: None,
            child: None,
            running: false,
        }
    }
}

impl SidecarState {
    /// Gracefully stop the sidecar — kills the child process if held.
    pub fn stop(&mut self) {
        if let Some(child) = self.child.take() {
            let _ = child.kill();
        }
        self.running = false;
        self.port = None;
    }
}

/// Start the Bun sidecar process.
/// Parses stdout for the "READY:{port}" line to learn the server port.
pub async fn start_sidecar(app: &AppHandle) -> Result<(), String> {
    let sidecar_command = app
        .shell()
        .sidecar("sidecar")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Store the child handle so we can kill it later
    {
        let state = app.state::<Mutex<SidecarState>>();
        if let Ok(mut guard) = state.lock() {
            guard.child = Some(child);
        }
    }

    // Wait for the READY line with a timeout
    let app_handle = app.clone();
    let timeout = Duration::from_secs(30);
    let start = std::time::Instant::now();

    while let Some(event) = rx.recv().await {
        if start.elapsed() > timeout {
            return Err("Sidecar startup timed out after 30s".to_string());
        }

        match event {
            CommandEvent::Stdout(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);
                let trimmed = line.trim();
                eprintln!("[sidecar:stdout] {}", trimmed);

                // Parse "READY:{port}" to learn the port
                if let Some(port_str) = trimmed.strip_prefix("READY:") {
                    if let Ok(port) = port_str.parse::<u16>() {
                        let state = app_handle.state::<Mutex<SidecarState>>();
                        if let Ok(mut state) = state.lock() {
                            state.port = Some(port);
                            state.running = true;
                        }
                        eprintln!("[sidecar] Ready on port {}", port);
                        return Ok(());
                    }
                }
            }
            CommandEvent::Stderr(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);
                eprintln!("[sidecar:stderr] {}", line.trim());
            }
            CommandEvent::Error(err) => {
                return Err(format!("Sidecar error: {}", err));
            }
            CommandEvent::Terminated(status) => {
                return Err(format!(
                    "Sidecar terminated unexpectedly with code: {:?}",
                    status.code
                ));
            }
            _ => {}
        }
    }

    Err("Sidecar process ended without sending READY".to_string())
}
