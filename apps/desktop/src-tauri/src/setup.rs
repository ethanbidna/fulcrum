use super::CoreSocket;
use serde_json::{json, Value};
use std::ffi::{CStr, CString};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;
const MAX_PROFILE_BYTES: u64 = 64 * 1024;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const MAX_KEYCHAIN_BYTES: u64 = 8192;
struct Selection { token: String, directory: PathBuf, mode: String, started: bool }
#[derive(Default)]
pub struct SetupState { selected: Mutex<Option<Selection>>, pub(super) lifecycle: Mutex<()> }
#[cfg(target_os = "macos")]
extern "C" {
    fn fulcrum_choose_directory(initial: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn fulcrum_new_identifier() -> *mut std::ffi::c_char;
    fn fulcrum_free_setup_string(value: *mut std::ffi::c_char);
    fn fulcrum_provider_keychain(action: *const std::ffi::c_char, input: *const std::ffi::c_char) -> *mut std::ffi::c_char;
}
#[cfg(target_os = "macos")]
fn native_string(value: *mut std::ffi::c_char) -> Result<String, String> {
    if value.is_null() { return Err("NATIVE_ACTION_CANCELLED_OR_DENIED".into()); }
    // Native helpers return owned UTF-8 allocations and never retain Rust input.
    let result = unsafe { CStr::from_ptr(value).to_string_lossy().into_owned() };
    unsafe { fulcrum_free_setup_string(value); }
    Ok(result)
}
pub(super) fn identifier() -> Result<String, String> {
    #[cfg(target_os = "macos")] { native_string(unsafe { fulcrum_new_identifier() }) }
    #[cfg(not(target_os = "macos"))] { Err("MACOS_REQUIRED".into()) }
}
pub(super) fn choose(initial: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")] {
        let text = CString::new(initial.to_string_lossy().as_bytes()).map_err(|_| "INVALID_FOLDER")?;
        native_string(unsafe { fulcrum_choose_directory(text.as_ptr()) }).map(PathBuf::from)
    }
    #[cfg(not(target_os = "macos"))] { let _ = initial; Err("MACOS_REQUIRED".into()) }
}
pub(super) fn read_private(file: &Path, owner: u32) -> Result<Option<Value>, String> {
    let metadata = match std::fs::symlink_metadata(file) { Ok(value) => value, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(_) => return Err("LOCAL_PROFILE_UNAVAILABLE".into()) };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.uid() != owner || metadata.mode() & 0o777 != 0o600 || metadata.len() > MAX_PROFILE_BYTES { return Err("LOCAL_PROFILE_UNSAFE".into()); }
    let bytes = std::fs::read(file).map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?;
    serde_json::from_slice(&bytes).map(Some).map_err(|_| "LOCAL_PROFILE_INVALID".into())
}
fn profile_directory(core: &CoreSocket) -> Result<(), String> {
    if !core.profile.exists() { std::fs::create_dir_all(&core.profile).map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?; std::fs::set_permissions(&core.profile, std::fs::Permissions::from_mode(0o700)).map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?; }
    let stat = std::fs::symlink_metadata(&core.profile).map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?;
    if !stat.is_dir() || stat.file_type().is_symlink() || stat.uid() != core.owner || stat.mode() & 0o777 != 0o700 { return Err("LOCAL_PROFILE_UNSAFE".into()); } Ok(())
}
pub(super) fn write_private(file: &Path, value: &Value) -> Result<(), String> {
    let parent = file.parent().ok_or("LOCAL_PROFILE_INVALID")?;
    let temporary = parent.join(format!(".setup-{}", identifier()?));
    let result = (|| {
        let mut output = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temporary).map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?;
        output.write_all(value.to_string().as_bytes()).map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?; output.sync_all().map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?;
        std::fs::rename(&temporary, file).map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?;
        std::fs::File::open(parent).and_then(|file| file.sync_all()).map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?; Ok(())
    })(); let _ = std::fs::remove_file(temporary); result
}
fn cloud_locations(home: &Path) -> (Option<PathBuf>, Option<PathBuf>) {
    let mut dropbox = home.join("Dropbox").is_dir().then(|| home.join("Dropbox")); let mut drive = None;
    if let Ok(entries) = std::fs::read_dir(home.join("Library/CloudStorage")) { for entry in entries.flatten() { if !entry.path().is_dir() { continue; } let name = entry.file_name().to_string_lossy().into_owned(); if name.starts_with("Dropbox") { dropbox = Some(entry.path()); } if name.starts_with("GoogleDrive-") { drive = Some(entry.path()); } } }
    (dropbox, drive)
}
pub(super) fn core_command(app: &tauri::AppHandle) -> Result<Command, String> {
    #[cfg(debug_assertions)] if let Some(binary) = std::env::var_os("FULCRUM_DEV_CORE") { return Ok(Command::new(binary)); }
    let binary = app.path().resource_dir().map_err(|_| "BUNDLED_CORE_UNAVAILABLE")?.join("bin/fulcrum-core");
    if !binary.is_file() { return Err("BUNDLED_CORE_UNAVAILABLE".into()); } Ok(Command::new(binary))
}
pub(super) fn launch(app: &tauri::AppHandle, core: &CoreSocket, directory: &Path, user: &str, label: &str, create: bool, recover: bool) -> Result<(), String> {
    let mut command = core_command(app)?;
    command.args(["--workspace", directory.to_str().ok_or("INVALID_FOLDER")?, "--user-entity", user, "--device-label", label]);
    if create { command.arg("--create"); }
    if recover { command.arg("--recover-workspace"); }
    let helper = std::env::current_exe().map_err(|_| "KEYCHAIN_HELPER_UNAVAILABLE")?;
    command.arg("--credential-helper").arg(helper);
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|_| "BUNDLED_CORE_UNAVAILABLE")?;
    let started = Instant::now();
    while started.elapsed() < if recover { Duration::from_secs(330) } else { STARTUP_TIMEOUT } {
        if child.try_wait().map_err(|_| "CORE_STARTUP_FAILED")?.is_some() { return Err("CORE_STARTUP_FAILED".into()); }
        let ready = core.connect().and_then(|mut client| client.request("health", json!({}))).is_ok();
        let saved = read_private(&core.profile.join("active-workspace.json"), core.owner).ok().flatten();
        let matches = saved.as_ref().and_then(|profile| profile["workspaceDirectory"].as_str())
            .is_some_and(|saved_path| Path::new(saved_path) == directory);
        if ready && matches { return Ok(()); }
        std::thread::sleep(POLL_INTERVAL);
    }
    let _ = child.kill(); let _ = child.wait(); Err("CORE_STARTUP_TIMEOUT".into())
}
fn ensure_saved(app: &tauri::AppHandle, core: &CoreSocket, profile: &Value) -> Result<(), String> {
    if core.connect().and_then(|mut client| client.request("health", json!({}))).is_ok() { return Ok(()); }
    let directory = PathBuf::from(profile["workspaceDirectory"].as_str().ok_or("LOCAL_PROFILE_INVALID")?);
    let user = profile["userEntityId"].as_str().ok_or("LOCAL_PROFILE_INVALID")?;
    let label = profile["deviceLabel"].as_str().unwrap_or("Local Mac");
    if !directory.is_absolute() || user.len() != 36 { return Err("LOCAL_PROFILE_INVALID".into()); }
    launch(app, core, &directory, user, label, false, false)
}
pub(super) fn stop_core(core: &CoreSocket) -> Result<(), String> {
    core.stop(); if let Ok(mut client) = core.connect() { client.request("shutdown", json!({}))?; } else { return Ok(()); }
    let started = Instant::now(); while core.profile.join("core.sock").exists() { if started.elapsed() >= STARTUP_TIMEOUT { return Err("CORE_SWITCH_TIMEOUT".into()); } std::thread::sleep(POLL_INTERVAL); } Ok(())
}
fn validate_folder(directory: &Path, mode: &str) -> Result<(), String> {
    if !directory.is_absolute() { return Err("INVALID_FOLDER".into()); }
    if let Ok(stat) = std::fs::symlink_metadata(directory) { if !stat.is_dir() || stat.file_type().is_symlink() { return Err("CHOOSE_A_REAL_FOLDER".into()); } }
    if mode == "create" {
        if directory.exists() && std::fs::read_dir(directory).map_err(|_| "FOLDER_UNAVAILABLE")?.next().is_some() { return Err("CHOOSE_AN_EMPTY_FOLDER_OR_OPEN_EXISTING".into()); }
    } else if !directory.join("workspace.json").is_file() { return Err("WORKSPACE_MANIFEST_REQUIRED".into()); } Ok(())
}
#[tauri::command]
pub async fn setup_request(app: tauri::AppHandle, core: tauri::State<'_, Arc<CoreSocket>>, state: tauri::State<'_, Arc<SetupState>>, name: String, args: Value) -> Result<Value, String> {
    let core = core.inner().clone(); let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = state.lifecycle.lock().map_err(|_| "SETUP_UNAVAILABLE")?;
        let home = app.path().home_dir().map_err(|_| "HOME_UNAVAILABLE")?; profile_directory(&core)?;
        match name.as_str() {
            "status" => {
                let saved = read_private(&core.profile.join("active-workspace.json"), core.owner)?;
                if let Some(profile) = saved.as_ref() { ensure_saved(&app, &core, profile)?; }
                let (dropbox, drive) = cloud_locations(&home);
                Ok(json!({"configured":saved.is_some(),"locations":[{"id":"documents","label":"In Documents","available":true},{"id":"dropbox","label":"In Dropbox","available":dropbox.is_some()},{"id":"drive","label":"In Google Drive","available":drive.is_some()}]}))
            }
            "choose" => {
                let location = args["location"].as_str().ok_or("INVALID_FOLDER_CHOICE")?; let mode = args["mode"].as_str().ok_or("INVALID_FOLDER_CHOICE")?;
                if !["create", "open"].contains(&mode) { return Err("INVALID_FOLDER_CHOICE".into()); }
                let (dropbox, drive) = cloud_locations(&home);
                let root = match location { "documents" => home.join("Documents"), "dropbox" => dropbox.ok_or("DROPBOX_NOT_FOUND")?, "drive" => drive.ok_or("GOOGLE_DRIVE_NOT_FOUND")?, "choose" => home.clone(), _ => return Err("INVALID_FOLDER_CHOICE".into()) };
                let directory = if location == "choose" || mode == "open" || location == "drive" { choose(&root)? } else { root.join("Fulcrum") };
                validate_folder(&directory, mode)?; let token = identifier()?;
                let cloud = directory.to_string_lossy().contains("CloudStorage") || directory.starts_with(home.join("Dropbox"));
                *state.selected.lock().map_err(|_| "SETUP_UNAVAILABLE")? = Some(Selection {token:token.clone(), directory:directory.clone(), mode:mode.to_owned(), started:false});
                Ok(json!({"token":token,"directory":directory,"mode":mode,"cloud":cloud}))
            }
            "open" => {
                let token = args["token"].as_str().ok_or("FOLDER_SELECTION_REQUIRED")?; let label = args["deviceLabel"].as_str().ok_or("DEVICE_NAME_REQUIRED")?;
                if label.trim().is_empty() || label.chars().count() > 80 { return Err("DEVICE_NAME_REQUIRED".into()); }
                let mut selected = state.selected.lock().map_err(|_| "SETUP_UNAVAILABLE")?; let selection = selected.as_mut().filter(|item| item.token == token).ok_or("FOLDER_SELECTION_REQUIRED")?;
                let retry_existing = selection.started && selection.directory.join("workspace.json").is_file();
                validate_folder(&selection.directory, if retry_existing { "open" } else { &selection.mode })?; let directory = selection.directory.clone(); let create = selection.mode == "create" && !retry_existing; selection.started = true; drop(selected);
                let profile_file = core.profile.join("active-workspace.json");
                let saved = match read_private(&profile_file, core.owner) { Ok(value) => value, Err(_) => { if profile_file.symlink_metadata().is_ok() { std::fs::rename(&profile_file, core.profile.join(format!("invalid-profile-{}.json", identifier()?))).map_err(|_| "LOCAL_PROFILE_UNAVAILABLE")?; } None } };
                let same = saved.as_ref().and_then(|profile| profile["workspaceDirectory"].as_str()).map(|value| Path::new(value) == directory).unwrap_or(false);
                let user = if same { saved.as_ref().and_then(|value| value["userEntityId"].as_str()).ok_or("LOCAL_PROFILE_INVALID")?.to_owned() } else { identifier()? };
                stop_core(&core)?;
                if !same { write_private(&core.profile.join("mcp-access.json"), &json!({"enabled":false,"readOnly":true,"sharingAcknowledged":false,"sourceExcerpts":false,"questionsVisible":true}))?; }
                launch(&app, &core, &directory, &user, label, create, !create)?; Ok(json!({"opened":true}))
            }
            _ => Err("SETUP_METHOD_NOT_ALLOWED".into())
        }
    }).await.map_err(|_| "SETUP_UNAVAILABLE".to_owned())?
}
pub fn keychain_mode() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect(); if args.get(1).map(String::as_str) != Some("--provider-keychain") { return None; }
    let action = args.get(2).map(String::as_str).unwrap_or(""); if !["get", "set", "remove"].contains(&action) { return Some(1); }
    let mut bytes = Vec::new(); if std::io::stdin().take(MAX_KEYCHAIN_BYTES + 1).read_to_end(&mut bytes).is_err() || bytes.len() as u64 > MAX_KEYCHAIN_BYTES { return Some(1); }
    #[cfg(target_os = "macos")] {
        let Ok(input) = CString::new(bytes) else { return Some(1); }; let Ok(action) = CString::new(action) else { return Some(1); };
        match native_string(unsafe { fulcrum_provider_keychain(action.as_ptr(), input.as_ptr()) }) { Ok(result) => { let _ = std::io::stdout().write_all(result.as_bytes()); Some(0) }, Err(_) => Some(1) }
    }
    #[cfg(not(target_os = "macos"))] { Some(1) }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn rejects_relative_workspace_paths() { assert!(validate_folder(Path::new("relative"), "create").is_err()); }
    #[test] fn existing_workspace_requires_manifest() { assert!(validate_folder(&std::env::temp_dir(), "open").is_err()); }
    #[test] fn create_refuses_nonempty_folders() { assert!(validate_folder(&std::env::temp_dir(), "create").is_err()); }
}
