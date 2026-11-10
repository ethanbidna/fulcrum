use std::ffi::CString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{Manager, menu::{Menu, MenuItem, MenuItemKind}};
use tauri_plugin_updater::UpdaterExt;
static CHECKING: AtomicBool = AtomicBool::new(false);
const ENDPOINT: &str = "https://github.com/ethanbidna/fulcrum/releases/latest/download/latest.json";
extern "C" { fn fulcrum_update_dialog(message: *const std::ffi::c_char, confirm: i32) -> i32; }
fn dialog(message: &str, confirm: bool) -> bool {
    let Ok(text) = CString::new(message) else { return false; };
    unsafe { fulcrum_update_dialog(text.as_ptr(), i32::from(confirm)) == 1 }
}
pub fn install(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = Menu::default(app.handle())?;
    let item = MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?;
    if let Some(MenuItemKind::Submenu(submenu)) = menu.items()?.first() { submenu.append(&item)?; }
    app.set_menu(menu)?;
    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() != "check-updates" || CHECKING.swap(true, Ordering::SeqCst) { return; }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let result = check(&app).await;
            if result.is_err() { dialog("The update did not finish. Reopen Fulcrum and try again later.", false); }
            CHECKING.store(false, Ordering::SeqCst);
        });
    });
    Ok(())
}
async fn check(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let Some(key) = option_env!("FULCRUM_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty()) else {
        dialog("This development build has no release update key. Install a signed release to use updates.", false); return Ok(());
    };
    let updater = app.updater_builder().pubkey(key).endpoints(vec![ENDPOINT.parse()?])?.timeout(Duration::from_secs(300)).build()?;
    let Some(update) = updater.check().await? else { dialog("You are using the latest published version.", false); return Ok(()); };
    if !dialog(&format!("Version {} is available. Download, verify and install this update, then restart Fulcrum?", update.version), true) { return Ok(()); }
    let bytes = update.download(|_, _| {}, || {}).await?;
    let core = app.state::<std::sync::Arc<super::CoreSocket>>();
    super::setup::stop_core(&core)?;
    update.install(bytes)?;
    app.restart();
}
