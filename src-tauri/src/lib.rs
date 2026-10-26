mod diagnostic;
mod power_inhibit;
mod receiver;
mod settings;
mod uxplay_args;
#[cfg(windows)]
mod windows_player;
#[cfg(windows)]
mod windows_job;

use std::{path::PathBuf, sync::Arc};
use receiver::{Controller, Snapshot};
use settings::{Settings, Theme};
use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder, AppHandle, Manager, RunEvent, WindowEvent};

fn controller(app: &AppHandle) -> Arc<Controller> { app.state::<Arc<Controller>>().inner().clone() }

#[tauri::command]
fn get_snapshot(app: AppHandle) -> Snapshot { controller(&app).snapshot() }
#[tauri::command]
fn get_settings(app: AppHandle) -> Settings { controller(&app).settings() }
// Appearance preference only: never commits unrelated draft receiver settings.
#[tauri::command]
fn set_theme(app: AppHandle, theme: Theme) -> Result<Snapshot,String> { controller(&app).set_theme(&app,theme) }
#[tauri::command]
fn set_stay_in_tray(app: AppHandle, stay_in_tray: bool) -> Result<Snapshot,String> {
    controller(&app).set_stay_in_tray(&app, stay_in_tray)
}

// Debug-only IPCs are intentionally absent from production executables.
#[cfg(debug_assertions)]
#[tauri::command]
fn start_simulated_mirroring(app: AppHandle) -> Result<Snapshot, String> {
    controller(&app).start_simulation(&app)
}
#[cfg(debug_assertions)]
#[tauri::command]
fn stop_simulated_mirroring(app: AppHandle) -> Snapshot {
    controller(&app).stop_simulation(&app)
}

// The main-window X uses persisted native settings, never an unsaved frontend draft.
// Both macOS (where closing a window normally leaves the app running) and Windows
// must explicitly take the same action for the same user preference.
#[derive(Debug, PartialEq, Eq)]
enum MainWindowCloseAction { HideToTray, Exit }
fn main_window_close_action(stay_in_tray: bool) -> MainWindowCloseAction {
    if stay_in_tray { MainWindowCloseAction::HideToTray } else { MainWindowCloseAction::Exit }
}
// The close-request callback runs inside the native event loop on macOS.
// Request a full process exit after the callback returns; attempting app.exit()
// synchronously while the close event is still being handled can be re-entrant.
// The existing RunEvent::Exit performs the receiver/child cleanup.
fn request_main_window_exit(app: AppHandle) {
    std::thread::spawn(move || app.exit(0));
}
#[tauri::command]
fn start_receiving(app: AppHandle) -> Snapshot { controller(&app).start(&app,true) }
#[tauri::command]
fn stop_receiving(app: AppHandle) -> Snapshot { controller(&app).stop(&app) }
#[tauri::command]
fn retry_receiving(app: AppHandle) -> Snapshot { controller(&app).retry(&app) }
#[tauri::command]
fn save_settings(app:AppHandle, settings: Settings) -> Result<Snapshot,String> { controller(&app).save_settings(&app,settings) }
#[tauri::command]
fn get_diagnostics(app:AppHandle) -> String { controller(&app).diagnostics() }

// The WebView's Blob download is not a dependable native-file export.
// Export only sanitized diagnostics supplied by Controller; never raw receiver stderr.
#[tauri::command]
fn export_diagnostics(app:AppHandle) -> Result<String,String> {
    let downloads=app.path().download_dir().map_err(|e| format!("无法定位下载目录：{e}"))?;
    let epoch=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("系统时间异常：{e}"))?.as_millis();
    let filename=format!("airpimo-diagnostics-{epoch}-{}.txt", std::process::id());
    let destination=downloads.join(filename);
    std::fs::write(&destination,controller(&app).diagnostics())
        .map_err(|e| format!("导出诊断日志失败（{}）：{e}",destination.display()))?;
    Ok(destination.to_string_lossy().to_string())
}

// Open the public project homepage using a fixed URL, never an arbitrary frontend URL.
#[tauri::command]
fn open_project_page() -> Result<(),String> {
    open_in_system_browser("https://github.com/rfw/Airpimo")
}

// Open only official GitHub release URLs in the system browser. Never run installers.
#[tauri::command]
fn open_release_page(url: String) -> Result<(),String> {
    let tail = url.strip_prefix("https://github.com/").ok_or("仅允许 GitHub Release 下载页")?;
    let parts:Vec<&str> = tail.split('/').collect();
    let valid = parts.len() == 5 && parts[2] == "releases" && parts[3] == "tag" &&
        parts[0] == "rfw" && parts[1] == "Airpimo" &&
        { let version=parts[4].strip_prefix('v').unwrap_or(parts[4]);
          version.split('.').count() == 3 && version.split('.').all(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_digit())) };
    if !valid { return Err("更新链接必须是官方仓库的稳定版 GitHub Release".into()); }
    open_in_system_browser(&url)
}

fn open_in_system_browser(url: &str) -> Result<(),String> {
    #[cfg(target_os="windows")]
    let result = std::process::Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(url).spawn();
    #[cfg(target_os="macos")]
    let result = std::process::Command::new("open").arg(url).spawn();
    #[cfg(not(any(target_os="windows",target_os="macos")))]
    let result = std::process::Command::new("xdg-open").arg(url).spawn();
    result.map(|_| ()).map_err(|e| format!("无法打开系统浏览器：{e}"))
}

// Brand migration: existing UxPlay Desktop users retain their saved receiver settings.
// Never overwrite settings already created by Airpimo; do not move or delete the old file.
fn migrate_legacy_airpimo_settings(current_path: &std::path::Path) {
    if current_path.exists() { return; }
    let Some(current_dir) = current_path.parent() else { return; };
    if current_dir.file_name().and_then(|n| n.to_str()) != Some("com.airpimo.desktop") { return; }
    let Some(config_root) = current_dir.parent() else { return; };
    let old_path = config_root.join("com.uxplaydesktop.receiver").join("settings.json");
    if !old_path.is_file() { return; }
    let (old_settings, valid) = settings::load(&old_path);
    if valid {
        if let Err(err) = settings::save(current_path, &old_settings) {
            eprintln!("Airpimo legacy settings migration skipped: {err}");
        }
    }
}

fn show_main(app:&AppHandle) {
    if let Some(window)=app.get_webview_window("main") {
        let _=window.unminimize(); let _=window.show(); let _=window.set_focus();
    }
}
// The native tray has exactly one receiver action. Its text tracks the
// controller state; activation always reads the latest state again.
struct TrayReceiverItem(MenuItem<tauri::Wry>);

pub(crate) fn sync_tray_receiver_item(app: &AppHandle) {
    if let Some(item) = app.try_state::<TrayReceiverItem>() {
        let label = if controller(app).tray_should_stop() { "停止接收" } else { "启动接收" };
        let _ = item.0.set_text(label);
    }
}

fn init_tray(app:&mut tauri::App) -> tauri::Result<()> {
    let show=MenuItem::with_id(app,"show","显示主窗口",true,None::<&str>)?;
    let receiver=MenuItem::with_id(app,"receiver","启动接收",true,None::<&str>)?;
    let quit=MenuItem::with_id(app,"quit","退出",true,None::<&str>)?;
    let menu=Menu::with_items(app,&[&show,&receiver,&quit])?;
    let icon=app.default_window_icon().expect("Tauri 配置必须包含图标").clone();
    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Airpimo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app,event| match event.id.as_ref() {
            "show"=>show_main(app),
            "receiver"=>{
                let core=controller(app);
                if core.tray_should_stop() { core.stop(app); }
                else { core.start(app,true); }
            },
            "quit"=>{controller(app).stop(app);app.exit(0);},
            _=>{},
        })
        .build(app)?;
    app.manage(TrayReceiverItem(receiver));
    Ok(())
}

#[cfg(windows)]
fn configure_windows_taskbar_id() {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }
    let name: Vec<u16> = OsStr::new("com.airpimo.desktop")
        .encode_wide().chain(Some(0)).collect();
    unsafe { SetCurrentProcessExplicitAppUserModelID(name.as_ptr()); }
}

pub fn run() {
    #[cfg(windows)]
    configure_windows_taskbar_id();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_| show_main(app)))
        .on_tray_icon_event(|app,event| {
            match event {
                #[cfg(target_os="windows")]
                tauri::tray::TrayIconEvent::DoubleClick {button:tauri::tray::MouseButton::Left,..} => show_main(app),
                // Tauri's native DoubleClick tray event is Windows-only.
                #[cfg(target_os="macos")]
                tauri::tray::TrayIconEvent::Click {button:tauri::tray::MouseButton::Left,button_state:tauri::tray::MouseButtonState::Up,..} => show_main(app),
                _=>{},
            }
        })
        .setup(|app| {
            let settings_dir=app.path().app_config_dir()?;
            let path:PathBuf=settings_dir.join("settings.json");
            migrate_legacy_airpimo_settings(&path);
            let core=Controller::new(path);
            let should_start=core.settings().auto_start;
            app.manage(core.clone());
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            init_tray(app)?;
            if should_start { core.start(app.handle(),true); }
            Ok(())
        })
        ;
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![get_snapshot,open_project_page,get_settings,set_theme,set_stay_in_tray,start_receiving,stop_receiving,retry_receiving,save_settings,get_diagnostics,export_diagnostics,open_release_page,start_simulated_mirroring,stop_simulated_mirroring]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![get_snapshot,open_project_page,get_settings,set_theme,set_stay_in_tray,start_receiving,stop_receiving,retry_receiving,save_settings,get_diagnostics,export_diagnostics,open_release_page]);
    builder.on_window_event(|window,event| {
            if window.label() != "main" { return; }
            if let WindowEvent::CloseRequested {api,..}=event {
                // Suppress Tauri's default window destruction on both platforms.
                // The native policy decides whether the main window stays alive hidden
                // or the whole app terminates (including its managed receiver job).
                api.prevent_close();
                let app=window.app_handle();
                let action = main_window_close_action(controller(app).settings().stay_in_tray);
                // Visible in `npm run tauri dev` logs when diagnosing macOS close behavior.
                eprintln!("Airpimo main-window close policy: {action:?}");
                match action {
                    MainWindowCloseAction::HideToTray => { let _=window.hide(); },
                    MainWindowCloseAction::Exit => request_main_window_exit(app.clone()),
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("无法构建 Tauri 应用")
        .run(|app,event| {
            if let RunEvent::Exit=event { controller(app).stop(app); }
        });
}

#[cfg(test)]
mod close_policy_tests {
    use super::*;
    #[test]
    fn close_button_respects_persisted_tray_setting_on_all_platforms() {
        assert_eq!(main_window_close_action(true), MainWindowCloseAction::HideToTray);
        assert_eq!(main_window_close_action(false), MainWindowCloseAction::Exit);
    }
}
