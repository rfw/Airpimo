mod diagnostic;
mod receiver;
mod settings;
mod uxplay_args;
#[cfg(windows)]
mod windows_player;

use std::{path::PathBuf, sync::Arc};
use receiver::{Controller, Snapshot};
use settings::Settings;
use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder, AppHandle, Manager, RunEvent, WindowEvent};

fn controller(app: &AppHandle) -> Arc<Controller> { app.state::<Arc<Controller>>().inner().clone() }

#[tauri::command]
fn get_snapshot(app: AppHandle) -> Snapshot { controller(&app).snapshot() }
#[tauri::command]
fn get_settings(app: AppHandle) -> Settings { controller(&app).settings() }
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
    #[cfg(target_os="windows")]
    let result = std::process::Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(&url).spawn();
    #[cfg(target_os="macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(not(any(target_os="windows",target_os="macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
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
fn init_tray(app:&mut tauri::App) -> tauri::Result<()> {
    let show=MenuItem::with_id(app,"show","显示主窗口",true,None::<&str>)?;
    let start=MenuItem::with_id(app,"start","启动接收",true,None::<&str>)?;
    let stop=MenuItem::with_id(app,"stop","停止接收",true,None::<&str>)?;
    let quit=MenuItem::with_id(app,"quit","退出",true,None::<&str>)?;
    let menu=Menu::with_items(app,&[&show,&start,&stop,&quit])?;
    let icon=app.default_window_icon().expect("Tauri 配置必须包含图标").clone();
    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Airpimo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app,event| match event.id.as_ref() {
            "show"=>show_main(app),
            "start"=>{controller(app).start(app,true);},
            "stop"=>{controller(app).stop(app);},
            "quit"=>{controller(app).stop(app);app.exit(0);},
            _=>{},
        })
        .build(app)?;
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
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![get_snapshot,get_settings,start_receiving,stop_receiving,retry_receiving,save_settings,get_diagnostics,export_diagnostics,open_release_page])
        .on_window_event(|window,event| {
            if let WindowEvent::CloseRequested {api,..}=event {
                let app=window.app_handle();
                if controller(app).settings().stay_in_tray {
                    api.prevent_close(); let _=window.hide();
                } else {
                    controller(app).stop(app);
                    app.exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("无法构建 Tauri 应用")
        .run(|app,event| {
            if let RunEvent::Exit=event { controller(app).stop(app); }
        });
}
