mod socket;
mod system;
mod setup;
mod updates;
use serde_json::Value;
use std::net::Shutdown;
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{Emitter, Manager};

struct CoreSocket {
    profile: PathBuf,
    owner: u32,
    subscription: Mutex<Option<UnixStream>>,
    generation: AtomicU64,
}
impl CoreSocket {
    fn connect(&self) -> Result<socket::Client, String> {
        if !self.profile.is_absolute() { return Err("UNSAFE_CORE_PROFILE".into()); }
        let directory = std::fs::symlink_metadata(&self.profile).map_err(|_| "CORE_UNAVAILABLE")?;
        let socket_path = self.profile.join("core.sock");
        let entry = std::fs::symlink_metadata(&socket_path).map_err(|_| "CORE_UNAVAILABLE")?;
        if !directory.is_dir() || directory.uid() != self.owner || directory.mode() & 0o777 != 0o700
            || !entry.file_type().is_socket() || entry.uid() != self.owner || entry.mode() & 0o777 != 0o600 {
            return Err("UNSAFE_CORE_PROFILE".into());
        }
        let secret = keychain_secret()?;
        socket::Client::connect(&socket_path, &secret)
    }
    fn stop(&self) {
        if let Ok(mut subscription) = self.subscription.lock() {
            self.generation.fetch_add(1, Ordering::SeqCst);
            if let Some(stream) = subscription.take() { let _ = stream.shutdown(Shutdown::Both); }
        }
    }
}
fn keychain_secret() -> Result<String, String> {
    const KEYCHAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
    const CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_millis(25);
    let mut child = Command::new("/usr/bin/security").args(["find-generic-password", "-s", "Fulcrum.Core", "-a", "local-client", "-w"])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_| "KEYCHAIN_UNAVAILABLE")?;
    let started = std::time::Instant::now();
    loop {
        if child.try_wait().map_err(|_| "KEYCHAIN_UNAVAILABLE")?.is_some() { break; }
        if started.elapsed() >= KEYCHAIN_TIMEOUT {
            let _ = child.kill(); let _ = child.wait(); return Err("KEYCHAIN_UNAVAILABLE".into());
        }
        std::thread::sleep(CHECK_INTERVAL);
    }
    let output = child.wait_with_output().map_err(|_| "KEYCHAIN_UNAVAILABLE")?;
    if !output.status.success() { return Err("KEYCHAIN_UNAVAILABLE".into()); }
    let secret = String::from_utf8(output.stdout).map_err(|_| "KEYCHAIN_UNAVAILABLE")?;
    let secret = secret.trim();
    if secret.len() != 64 || !secret.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err("KEYCHAIN_UNAVAILABLE".into()); }
    Ok(secret.to_owned())
}
#[tauri::command]
async fn core_request(state: tauri::State<'_, Arc<CoreSocket>>, method: String, params: Value) -> Result<Value, String> {
    if !["administration", "health", "query", "execute", "planCommand", "commandPlanStatus", "cancelCommandPlan", "applyCommandPlan", "background.configure"].contains(&method.as_str()) { return Err("METHOD_NOT_ALLOWED".into()); }
    let client = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || client.connect()?.request(&method, params)).await.map_err(|_| "CORE_UNAVAILABLE".to_string())?
}
#[tauri::command]
async fn core_subscribe(app: tauri::AppHandle, state: tauri::State<'_, Arc<CoreSocket>>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state.subscription.lock().map_err(|_| "CORE_UNAVAILABLE")?;
        if guard.is_some() { return Ok(()); }
        let mut client = state.connect()?;
        client.request("subscribe", serde_json::json!({}))?;
        *guard = Some(client.subscription_stream()?);
        let generation = state.generation.load(Ordering::SeqCst);
        drop(guard);
        std::thread::spawn(move || {
            while let Ok(message) = client.read() {
                if message["jsonrpc"] != "2.0" || message["method"] != "AppliedChange" { break; }
                if let Some(change) = message.get("params") { let _ = app.emit_to("main", "core-change", change); }
            }
            if let Ok(mut subscription) = state.subscription.lock() {
                if state.generation.load(Ordering::SeqCst) == generation { subscription.take(); }
            }
        });
        Ok(())
    }).await.map_err(|_| "CORE_UNAVAILABLE".to_string())?
}
#[tauri::command]
fn core_unsubscribe(state: tauri::State<'_, Arc<CoreSocket>>) { state.stop(); }
fn core_profile(home: &std::path::Path) -> PathBuf {
    #[cfg(debug_assertions)]
    if let Some(profile) = std::env::var_os("FULCRUM_DEV_PROFILE") { return PathBuf::from(profile); }
    home.join("Library/Application Support/Fulcrum")
}
fn main() {
    if let Some(code) = setup::keychain_mode() { std::process::exit(code); }
    let app = tauri::Builder::default()
        .setup(|app| {
            updates::install(app)?;
            let home = app.path().home_dir()?;
            let owner = std::fs::metadata(&home)?.uid();
            let core = Arc::new(CoreSocket { profile: core_profile(&home), owner, subscription: Mutex::new(None), generation: AtomicU64::new(0) });
            app.manage(system::SystemObserver::start(core.clone()));
            app.manage(core);
            app.manage(Arc::new(setup::SetupState::default()));
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![core_request, core_subscribe, core_unsubscribe, setup::setup_request])
        .build(tauri::generate_context!()).expect("Fulcrum shell startup failed");
    app.run(|app, event| {
        match event {
            tauri::RunEvent::Exit => { app.state::<system::SystemObserver>().stop(); app.state::<Arc<CoreSocket>>().stop(); }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
            }
            _ => {}
        }
    });
}
