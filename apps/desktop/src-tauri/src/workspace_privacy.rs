use super::{CoreSocket, setup};
use serde_json::{json, Value};
use std::{ffi::CString, io::{Read, Write}, path::{Path, PathBuf}, process::Stdio, sync::Arc, time::{Duration, Instant}};
use tauri::{Manager, menu::{MenuItem, MenuItemKind}};

const COPY_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_RESULT: u64 = 16 * 1024;
const COPY: &str = "workspace-encrypt-copy";
const ROTATE: &str = "workspace-rotate-key";
const LOCK: &str = "workspace-lock";
const UNLOCK: &str = "workspace-unlock";

extern "C" { fn fulcrum_privacy_notice(message: *const std::ffi::c_char); }
extern "C" { fn fulcrum_privacy_dialog(message: *const std::ffi::c_char, button: *const std::ffi::c_char) -> i32; }
fn confirm(text: &str, button: &str) -> bool {
    let (Ok(text), Ok(button)) = (CString::new(text), CString::new(button)) else { return false; };
    unsafe { fulcrum_privacy_dialog(text.as_ptr(), button.as_ptr()) == 1 }
}
fn report(text: &str) {
    if let Ok(text) = CString::new(text) { unsafe { fulcrum_privacy_notice(text.as_ptr()); } }
}
pub fn add_menu(app: &tauri::App, menu: &tauri::menu::Menu<tauri::Wry>) -> tauri::Result<()> {
    let Some(MenuItemKind::Submenu(submenu)) = menu.items()?.into_iter().next() else { return Ok(()); };
    for (id, text) in [(COPY, "Create Encrypted Workspace Copy…"), (ROTATE, "Rotate Workspace Recovery Key…"), (LOCK, "Lock Encrypted Workspace"), (UNLOCK, "Unlock Encrypted Workspace…")] {
        submenu.append(&MenuItem::with_id(app, id, text, true, None::<&str>)?)?;
    }
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref().to_owned();
        if ![COPY, ROTATE, LOCK, UNLOCK].contains(&id.as_str()) { return; }
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if perform(&app, &id).is_err() {
                report("Workspace privacy action could not finish. The source workspace was kept. Check that you have a signed build with workspace Keychain support.");
            }
        });
    });
    Ok(())
}
#[tauri::command]
pub async fn privacy_request(app: tauri::AppHandle, action: String, backup_id: Option<String>) -> Result<(), String> {
    if action == "restore" {
        let backup = backup_id.filter(|id| valid_id(id)).ok_or("INVALID_BACKUP")?;
        return tauri::async_runtime::spawn_blocking(move || restore(&app, &backup)).await.map_err(|_| "PRIVACY_ACTION_UNAVAILABLE".to_owned())?;
    }
    let id = match action.as_str() { "copy" => COPY, "lock" => LOCK, _ => return Err("PRIVACY_ACTION_UNAVAILABLE".into()) };
    tauri::async_runtime::spawn_blocking(move || perform(&app, id)).await.map_err(|_| "PRIVACY_ACTION_UNAVAILABLE".to_owned())?
}
struct ActiveWorkspace { directory: PathBuf, user: String, label: String, id: String }
fn valid_id(value: &str) -> bool {
    value.len() == 36 && value.bytes().enumerate().all(|(index, byte)|
        if [8,13,18,23].contains(&index) { byte == b'-' } else { byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) })
}
fn active(core: &CoreSocket) -> Result<ActiveWorkspace, String> {
    let value = setup::read_private(&core.profile.join("active-workspace.json"), core.owner)?.ok_or("NO_WORKSPACE")?;
    let string = |field: &str| value[field].as_str().map(str::to_owned).ok_or("INVALID_PROFILE");
    let directory = PathBuf::from(string("workspaceDirectory")?);
    let user = string("userEntityId")?;
    let id = string("workspaceId")?;
    if !directory.is_absolute() || !valid_id(&user) || !valid_id(&id) { return Err("INVALID_PROFILE".into()); }
    Ok(ActiveWorkspace { directory, user, id, label: string("deviceLabel")? })
}
fn storage_version(workspace: &ActiveWorkspace) -> Result<u64, String> {
    let file = std::fs::File::open(workspace.directory.join("workspace.json")).map_err(|_| "INVALID_WORKSPACE")?;
    let mut bytes = Vec::new();
    file.take(MAX_RESULT + 1).read_to_end(&mut bytes).map_err(|_| "INVALID_WORKSPACE")?;
    if bytes.len() as u64 > MAX_RESULT { return Err("INVALID_WORKSPACE".into()); }
    let manifest: Value = serde_json::from_slice(&bytes).map_err(|_| "INVALID_WORKSPACE")?;
    if manifest["workspaceId"].as_str() != Some(&workspace.id) { return Err("INVALID_WORKSPACE".into()); }
    manifest["schemaVersion"].as_u64().ok_or_else(|| "INVALID_WORKSPACE".into())
}
fn perform(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let core = app.state::<Arc<CoreSocket>>();
    let state = app.state::<Arc<setup::SetupState>>();
    let _guard = state.lifecycle.try_lock().map_err(|_| "WORKSPACE_BUSY")?;
    let workspace = active(&core)?;
    let version = storage_version(&workspace)?;
    match (id, version) {
        (COPY, 1) => encrypt_copy(app, &core, &workspace, "copy", None),
        (ROTATE, 2) => encrypt_copy(app, &core, &workspace, "rotate", None),
        (LOCK, 2) => {
            setup::write_private(&core.profile.join(format!("locked-{}", workspace.id)), &json!({"locked":true}))?;
            let result = setup::stop_core(&core);
            if result.is_err() { report("Workspace reads are blocked, but the background process did not exit. Quit Fulcrum and reopen it before unlocking."); }
            app.restart()
        }
        (UNLOCK, 2) => {
            if !confirm("Open this encrypted workspace on this Mac? If its Keychain item is missing you can import a saved card.", "Unlock Workspace") { return Ok(()); }
            let marker = core.profile.join(format!("locked-{}", workspace.id));
            if !marker.exists() && core.connect().and_then(|mut client| client.request("health", json!({}))).is_ok() {
                return Ok(());
            }
            setup::stop_core(&core)?;
            match std::fs::remove_file(&marker) {
                Ok(()) => {},
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                Err(_) => return Err("LOCK_MARKER_UNAVAILABLE".into())
            }
            if let Err(error) = setup::launch(app, &core, &workspace.directory, &workspace.user, &workspace.label, false, true) {
                setup::write_private(&marker, &json!({"locked":true}))?;
                return Err(error);
            }
            app.restart()
        }
        _ => Err("WORKSPACE_FORMAT_UNSUPPORTED".into())
    }
}
fn restore(app: &tauri::AppHandle, backup: &str) -> Result<(), String> {
    let core = app.state::<Arc<CoreSocket>>();
    let state = app.state::<Arc<setup::SetupState>>();
    let _guard = state.lifecycle.try_lock().map_err(|_| "WORKSPACE_BUSY")?;
    let workspace = active(&core)?;
    if storage_version(&workspace)? != 2 { return Err("ENCRYPTED_SOURCE_REQUIRED".into()); }
    encrypt_copy(app, &core, &workspace, "restore", Some(backup))
}
fn encrypt_copy(app: &tauri::AppHandle, core: &CoreSocket, workspace: &ActiveWorkspace, operation: &str, backup: Option<&str>) -> Result<(), String> {
    let bundle = std::env::current_exe().map_err(|_| "PROVISIONED_BUILD_REQUIRED")?;
    let contents = bundle.parent().and_then(Path::parent).ok_or("PROVISIONED_BUILD_REQUIRED")?;
    if !contents.join("embedded.provisionprofile").is_file() { return Err("PROVISIONED_BUILD_REQUIRED".into()); }
    let parent = setup::choose(workspace.directory.parent().unwrap_or(&workspace.directory))?;
    let destination = parent.join(format!("Encrypted Workspace {}", setup::identifier()?));
    let disclosure = match operation {
        "copy" => "Pause other Macs and make the complete source available offline. A verified plaintext backup and the original will be kept.",
        "rotate" => "Pause other Macs and make the complete source available offline. This creates a new workspace and key. The old key can still open old copies.",
        _ => "Restore the verified backup into a separate workspace with a new key. The current workspace and backup will be kept.",
    };
    if !confirm(&format!("{disclosure}\n\nFrom: {}\nTo: {}", workspace.directory.display(), destination.display()), "Create Encrypted Copy") { return Ok(()); }
    setup::stop_core(core)?;
    let result = run_copy(app, &workspace.directory, &destination, operation, backup);
    if let Err(error) = result {
        let _ = setup::launch(app, core, &workspace.directory, &workspace.user, &workspace.label, false, false);
        return Err(error);
    }
    if let Err(error) = setup::launch(app, core, &destination, &workspace.user, &workspace.label, false, false) {
        let _ = setup::launch(app, core, &workspace.directory, &workspace.user, &workspace.label, false, false);
        return Err(error);
    }
    report("The encrypted copy is active. The previous workspace and backup remain in place. Use the new folder and recovery card on your other Macs.");
    app.restart()
}
fn run_copy(app: &tauri::AppHandle, source: &Path, destination: &Path, operation: &str, backup: Option<&str>) -> Result<(), String> {
    let mut child = setup::core_command(app)?.arg("--encrypt-copy")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_| "COPY_UNAVAILABLE")?;
    let mut input = json!({"source":source,"destination":destination,"operation":operation});
    if let Some(backup) = backup { input["backupId"] = json!(backup); }
    let input = input.to_string();
    let result = child.stdin.take().ok_or("COPY_PIPE_UNAVAILABLE").and_then(|mut pipe| pipe.write_all(input.as_bytes()).map_err(|_| "COPY_PIPE_UNAVAILABLE"));
    if result.is_err() { let _ = child.kill(); let _ = child.wait(); return Err("COPY_PIPE_UNAVAILABLE".into()); }
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|_| "COPY_FAILED")? {
            return if status.success() { Ok(()) } else { Err("COPY_FAILED".into()) };
        }
        if start.elapsed() > COPY_TIMEOUT { let _ = child.kill(); let _ = child.wait(); return Err("COPY_TIMEOUT".into()); }
        std::thread::sleep(Duration::from_millis(100));
    }
}
