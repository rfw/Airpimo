use crate::{diagnostic::{self, Observation}, settings::{self, Settings}};
use serde::Serialize;
use std::{collections::VecDeque, io::{BufRead, BufReader, Read}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, thread, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// Hide the UxPlay console on Windows while retaining stdout/stderr pipes.
// CREATE_NO_WINDOW is supported by Windows 7; do not use DETACHED_PROCESS,
// which would interfere with diagnostics and child process supervision.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const LOG_LIMIT: usize = 250;
// A second IPC/tray Start may arrive while the first is resolving the engine or
// spawning its child. `child.is_some()` alone does not protect this interval.
fn start_already_in_progress(child_present: bool, stopping: bool, stage: &str) -> bool {
    child_present || (!stopping && stage == "starting")
}
fn unix_now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }

#[derive(Clone, Serialize)]
pub struct Snapshot {
    stage: &'static str,
    detail: String,
    issue: Option<&'static str>,
    device_name: String,
    applied_device_name: Option<String>,
    applied_fps: Option<u16>,
    applied_brightness: Option<u8>,
    applied_uxplay_args: Option<String>,
    process_running: bool,
    discovery_verified: bool,
    audio_verified: bool,
    connected_since: Option<u64>,
    restart_attempts: u8,
    settings: Settings,
}
struct Inner {
    settings: Settings,
    stage: &'static str,
    detail: String,
    issue: Option<&'static str>,
    child: Option<Child>,
    epoch: u64,
    stopping: bool,
    restart_attempts: u8,
    applied_device_name: Option<String>,
    applied_fps: Option<u16>,
    applied_brightness: Option<u8>,
    applied_uxplay_args: Option<String>,
    connected_since: Option<u64>,
    started_at: Option<Instant>,
    connecting_at: Option<Instant>,
    logs: VecDeque<String>,
}
impl Inner {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            stage: self.stage, detail: self.detail.clone(), issue: self.issue,
            device_name: self.settings.device_name.clone(), applied_device_name: self.applied_device_name.clone(),
            applied_fps: self.applied_fps,
            applied_brightness: self.applied_brightness,
            applied_uxplay_args: self.applied_uxplay_args.clone(),
            process_running: self.child.is_some(), discovery_verified: false, audio_verified: false,
            connected_since: self.connected_since, restart_attempts: self.restart_attempts,
            settings: self.settings.clone(),
        }
    }
    fn log(&mut self, key: &str) {
        if self.logs.len() >= LOG_LIMIT { self.logs.pop_front(); }
        self.logs.push_back(format!("{} | {}", unix_now(), key));
    }
}
pub struct Controller { inner: Mutex<Inner>, settings_path: PathBuf }
impl Controller {
    pub fn new(settings_path: PathBuf) -> Arc<Self> {
        let (settings, valid) = settings::load(&settings_path);
        let mut logs = VecDeque::new();
        if !valid { logs.push_back(format!("{} | invalid_settings_reset", unix_now())); }
        Arc::new(Self { inner: Mutex::new(Inner {
            settings, stage:"stopped", detail:"接收服务已停止".into(), issue:None, child:None,
            epoch:0, stopping:true, restart_attempts:0, applied_device_name:None, applied_fps:None, applied_brightness:None, applied_uxplay_args:None,
            connected_since:None, started_at:None, connecting_at:None, logs,
        }), settings_path })
    }
    pub fn settings(&self) -> Settings { self.inner.lock().unwrap().settings.clone() }
    pub fn snapshot(&self) -> Snapshot { self.inner.lock().unwrap().snapshot() }
    fn publish(&self, app: &AppHandle) { let _ = app.emit("receiver://snapshot", self.snapshot()); }
    fn error(&self, app: &AppHandle, epoch: u64, issue: &'static str, message: &str) {
        { let mut inner = self.inner.lock().unwrap(); if inner.epoch != epoch || inner.stopping { return; } inner.stage="error"; inner.detail=message.to_owned(); inner.issue=Some(issue); inner.log(issue); }
        self.publish(app);
    }
    pub fn save_settings(self: &Arc<Self>, app: &AppHandle, mut next: Settings) -> Result<Snapshot,String> {
        settings::validate_name(&next.device_name)?;
        settings::validate_fps(next.fps)?;
        settings::validate_brightness(next.brightness)?;
        crate::uxplay_args::validate(&next.uxplay_args)?;
        next.device_name = next.device_name.trim().to_string();
        // Disk write and state mutation share the same lock; concurrent IPC writes cannot race
        // against the same temporary filename or desynchronize saved/current settings.
        { let mut inner = self.inner.lock().unwrap();
          settings::save(&self.settings_path, &next)?;
          inner.settings = next; inner.log("settings_saved"); }
        self.publish(app);
        Ok(self.snapshot())
    }
    pub fn diagnostics(&self) -> String {
        let inner = self.inner.lock().unwrap();
        format!("AIRPIMO / LOCAL DIAGNOSTICS\nGenerated Unix time: {}\nStatus: {}\nProcess running: {}\nDiscovery externally verified: false\nAudio externally verified: false\nRecovery attempts: {}\nDevice name intentionally omitted from log\n\n{}\n",
            unix_now(), inner.stage, inner.child.is_some(), inner.restart_attempts,
            inner.logs.iter().cloned().collect::<Vec<_>>().join("\n"))
    }
    pub fn stop(self: &Arc<Self>, app: &AppHandle) -> Snapshot {
        let child = {
            let mut i=self.inner.lock().unwrap();
            i.stopping=true; i.epoch+=1; i.stage="stopped"; i.detail="接收服务已停止".into();
            i.issue=None; i.connected_since=None; i.connecting_at=None; i.applied_device_name=None; i.applied_fps=None; i.applied_brightness=None; i.applied_uxplay_args=None; i.restart_attempts=0;
            i.log("stopped_by_user"); i.child.take()
        };
        if let Some(mut child) = child { let _ = child.kill(); let _ = child.wait(); }
        self.publish(app);
        self.snapshot()
    }
    pub fn retry(self: &Arc<Self>, app: &AppHandle) -> Snapshot {
        self.stop(app);
        self.start(app, true)
    }
    pub fn start(self: &Arc<Self>, app: &AppHandle, reset_backoff: bool) -> Snapshot {
        let (epoch, name, fps, brightness, user_args) = {
            let mut i=self.inner.lock().unwrap();
            if start_already_in_progress(i.child.is_some(), i.stopping, i.stage) { return i.snapshot(); }
            i.stopping=false;
            if reset_backoff { i.restart_attempts=0; }
            i.epoch+=1; i.stage="starting"; i.detail="正在启动 UxPlay…".into(); i.issue=None;
            i.connected_since=None; i.connecting_at=None; i.started_at=Some(Instant::now()); i.applied_device_name=None; i.applied_fps=None; i.applied_brightness=None; i.applied_uxplay_args=None;
            i.log("starting_receiver"); (i.epoch, i.settings.device_name.clone(), i.settings.fps, i.settings.brightness, i.settings.uxplay_args.clone())
        };
        self.publish(app);
        let (binary, dev_binary) = match sidecar_path(app) {
            Ok(path)=>path,
            Err(err)=>{ self.error(app,epoch,"missing_binary",&err); return self.snapshot(); }
        };
        // GUI settings always win, then expert parameters, then built-in defaults.
        let effective_args = match crate::uxplay_args::effective(&name, fps, brightness, &user_args) {
            Ok(args) => args,
            Err(err) => { self.error(app, epoch, "unknown", &err); return self.snapshot(); }
        };
        let mut command = Command::new(&binary);
        command.args(&effective_args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        // Runtime lookup limited to the packaged GStreamer directory; no inherited global plugins.
        if let Err(err) = setup_gstreamer(app, &mut command, dev_binary) {
            self.error(app,epoch,"missing_runtime",&err); return self.snapshot();
        }
        // The video is in the UxPlay process, not the Tauri control window.
        #[cfg(target_os = "macos")]
        if let Err(err) = setup_mac_video_controls(app, &mut command, dev_binary) {
            self.error(app, epoch, "missing_runtime", &err);
            return self.snapshot();
        }
        // UxPlay is a Windows console application. Without this flag Windows
        // opens a cmd-like window for the entire AirPlay receiver lifetime.
        // Piped stdout/stderr remain available to spawn_log_reader.
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        let mut child = match command.spawn() {
            Ok(child)=>child,
            Err(err)=>{ self.error(app,epoch,"missing_binary", &format!("UxPlay 无法启动：{err}")); return self.snapshot(); }
        };
        // Only observe video windows owned by the newly spawned UxPlay child.
        // No global Windows message hooks or user input capture is installed.
        #[cfg(windows)]
        crate::windows_player::watch(child.id());
        let stdout=child.stdout.take(); let stderr=child.stderr.take();
        {
            let mut i=self.inner.lock().unwrap();
            if i.epoch != epoch || i.stopping { let _=child.kill(); let _=child.wait(); return i.snapshot(); }
            i.child=Some(child); i.applied_device_name=Some(name); i.applied_fps=Some(fps); i.applied_brightness=Some(brightness); i.applied_uxplay_args=Some(user_args);
            if dev_binary { i.log("development_local_binary_unbundled_gstreamer"); }
            i.log("sidecar_spawned_discovery_unverified");
        }
        self.publish(app);
        // ChildStdout and ChildStderr are different concrete types. Do not put
        // Option<ChildStdout> and Option<ChildStderr> in one homogeneous array.
        // The generic reader accepts each stream independently while preserving
        // the same normalization/epoch guard for both output channels.
        if let Some(output) = stdout {
            spawn_log_reader(output, self.clone(), app.clone(), epoch);
        }
        if let Some(output) = stderr {
            spawn_log_reader(output, self.clone(), app.clone(), epoch);
        }
        {
            let owner=self.clone(); let app_clone=app.clone();
            thread::spawn(move || { thread::sleep(Duration::from_millis(1700)); owner.mark_waiting(&app_clone,epoch); });
        }
        {
            let owner=self.clone(); let app_clone=app.clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(350));
                let (result, timed_out) = {
                    let mut i=owner.inner.lock().unwrap();
                    if i.epoch != epoch || i.stopping { return; }
                    let timed_out = i.stage == "connecting" && i.connecting_at.map(|t| t.elapsed() > Duration::from_secs(15)).unwrap_or(false);
                    if timed_out {
                        i.stage = "waiting";
                        i.detail = "本次连接未完成，继续等待手机投屏".into();
                        i.connecting_at = None;
                        i.log("connection_handshake_timeout");
                    }
                    let result=match i.child.as_mut() {Some(child)=>child.try_wait(), None=>return};
                    (result, timed_out)
                };
                if timed_out { owner.publish(&app_clone); }
                match result {
                    Ok(Some(status)) => { owner.handle_exit(&app_clone,epoch,status.code()); return; }
                    Ok(None) => {}
                    Err(_) => { owner.handle_exit(&app_clone,epoch,None); return; }
                }
            });
        }
        self.snapshot()
    }
    fn mark_waiting(&self, app:&AppHandle, epoch:u64) {
        {
            let mut i=self.inner.lock().unwrap();
            if i.epoch!=epoch || i.stopping || i.child.is_none() || i.stage!="starting" {return;}
            i.stage="waiting"; i.detail="接收进程运行中；尚未验证 mDNS 广播".into(); i.log("process_running_discovery_unverified");
        }
        self.publish(app);
    }
    fn observe(&self, app:&AppHandle, epoch:u64, line:&str) {
        let observation=diagnostic::classify(line);
        if observation==Observation::None {return;}
        {
            let mut i=self.inner.lock().unwrap();
            if i.epoch!=epoch || i.stopping || i.child.is_none() {return;}
            match observation {
                Observation::Connecting=>{
                    if i.stage=="waiting" || i.stage=="starting" {
                        i.stage="connecting"; i.connecting_at=Some(Instant::now()); i.detail="已发现连接尝试，镜像尚未建立".into(); i.log("client_connection_attempt");
                    }
                },
                Observation::MirrorStarted=>{
                    i.stage="connected"; i.detail="镜像画面连接已建立（声音待实测）".into();
                    i.connected_since=Some(unix_now()); i.connecting_at=None; i.issue=None; i.log("mirror_started");
                },
                Observation::MirrorEnded=>{
                    i.stage="waiting"; i.detail="投屏已断开，接收进程仍运行".into();
                    i.connected_since=None; i.connecting_at=None; i.issue=None; i.log("mirror_ended");
                },
                Observation::Error(code,message)=>{
                    i.stage="error"; i.detail=message.into(); i.issue=Some(code); i.log(code);
                },
                Observation::None=>return,
            }
        }
        self.publish(app);
    }
    fn handle_exit(self: &Arc<Self>, app:&AppHandle, epoch:u64, exit_code: Option<i32>) {
        let retry_delay = {
            let mut i=self.inner.lock().unwrap();
            if i.epoch!=epoch || i.stopping {return;}
            i.child.take(); i.connected_since=None; i.connecting_at=None; i.applied_device_name=None; i.applied_fps=None; i.applied_brightness=None; i.applied_uxplay_args=None;
            if i.started_at.map(|t| t.elapsed() > Duration::from_secs(60)).unwrap_or(false) { i.restart_attempts=0; }
            i.restart_attempts=i.restart_attempts.saturating_add(1);
            i.stage="error";
            if i.issue.is_none() {
                #[cfg(windows)]
                if exit_code == Some(-1073741515) { // NTSTATUS 0xC0000135: STATUS_DLL_NOT_FOUND
                    i.issue = Some("missing_runtime");
                    i.detail = "UxPlay 启动失败（0xC0000135）：缺少 DLL 或 DLL 依赖版本不兼容，请检查 GStreamer Runtime 与诊断信息".into();
                } else {
                    i.issue = Some("crash");
                    i.detail = format!("UxPlay 意外退出（退出码 {}）",exit_code.map(|n|n.to_string()).unwrap_or_else(||"unknown".into()));
                }
                #[cfg(not(windows))]
                { i.issue=Some("crash"); i.detail=format!("UxPlay 意外退出（退出码 {}）",exit_code.map(|n|n.to_string()).unwrap_or_else(||"unknown".into())); }
            }
            i.log("sidecar_unexpected_exit");
            diagnostic::backoff_secs(i.restart_attempts)
        };
        self.publish(app);
        if let Some(delay)=retry_delay {
            let owner=self.clone(); let app_clone=app.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(delay));
                let allowed={ let i=owner.inner.lock().unwrap(); !i.stopping && i.epoch==epoch && i.child.is_none() };
                if allowed { owner.start(&app_clone,false); }
            });
        }
    }
}


/// Stream-neutral log consumption: works with both ChildStdout and ChildStderr.
/// Keep parsing in a single place so stderr errors cannot be silently dropped.
fn consume_lines<R: Read>(input: R, mut on_line: impl FnMut(&str)) {
    for line in BufReader::new(input).lines() {
        match line {
            Ok(line) => on_line(&line),
            Err(_) => break,
        }
    }
}

fn spawn_log_reader<R: Read + Send + 'static>(
    output: R,
    owner: Arc<Controller>,
    app: AppHandle,
    epoch: u64,
) {
    thread::spawn(move || consume_lines(output, |line| owner.observe(&app, epoch, line)));
}

#[cfg(test)]
mod stream_tests {
    use super::{consume_lines, start_already_in_progress};
    use std::io::{Cursor, Read};

    fn events_from<R: Read>(stream: R) -> Vec<String> {
        let mut lines = Vec::new();
        consume_lines(stream, |line| lines.push(line.to_owned()));
        lines
    }

    #[test]
    fn start_guard_blocks_parallel_start_before_child_spawn() {
        assert!(start_already_in_progress(false, false, "starting"));
        assert!(start_already_in_progress(true, false, "waiting"));
        assert!(start_already_in_progress(true, true, "stopped"));
        assert!(!start_already_in_progress(false, false, "error"));
        assert!(!start_already_in_progress(false, true, "stopped"));
    }

    #[test]
    fn handles_stdout_and_stderr_independently() {
        let stdout = Cursor::new(b"Accepted IPv4 client on socket 12\nraop_rtp_mirror starting mirroring\n".to_vec());
        let stderr = Cursor::new(b"Address already in use\nGStreamer plugin not found\n".to_vec());
        assert_eq!(events_from(stdout), vec![
            String::from("Accepted IPv4 client on socket 12"),
            String::from("raop_rtp_mirror starting mirroring"),
        ]);
        assert_eq!(events_from(stderr), vec![
            String::from("Address already in use"),
            String::from("GStreamer plugin not found"),
        ]);
    }

    #[test]
    fn empty_and_unicode_lines_are_safe() {
        assert!(events_from(Cursor::new(Vec::<u8>::new())).is_empty());
        assert_eq!(events_from(Cursor::new("设备连接成功\n".as_bytes())), vec![String::from("设备连接成功")]);
    }
}

// This override only exists in debug builds. Production must use the shipped
// engine and GStreamer resources; never silently fall back to Homebrew/PATH.
fn sidecar_path(app: &AppHandle) -> Result<(PathBuf, bool), String> {
    #[cfg(debug_assertions)]
    if let Some(override_path) = std::env::var_os("UXPLAY_DEV_BINARY") {
        let requested = PathBuf::from(override_path);
        if !requested.is_absolute() || !requested.is_file() {
            return Err("开发模式指定的 UxPlay 路径无效；请使用绝对路径和可执行文件".into());
        }
        return Ok((requested, true));
    }
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    #[cfg(windows)] let filename = "uxplay.exe";
    #[cfg(not(windows))] let filename = "uxplay";
    let path = dir.join("sidecar").join(filename);
    if path.is_file() { return Ok((path, false)); }
    #[cfg(debug_assertions)] {
        let local = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources").join("sidecar").join(filename);
        if local.is_file() { return Ok((local, false)); }
        return Err("开发模式未找到 UxPlay。请执行 npm run native:doctor，或使用 npm run desktop:dev -- --uxplay /绝对路径/UxPlay/build/uxplay".into());
    }
    #[cfg(not(debug_assertions))]
    Err("安装包缺少内置 UxPlay 引擎，请重新安装经完整原生打包检查的版本".into())
}
fn setup_gstreamer(app: &AppHandle, command: &mut Command, development: bool) -> Result<(), String> {
    // UxPlay already works on this developer's Mac using system-installed
    // GStreamer. Preserve its lookup environment only in debug/development mode.
    #[cfg(debug_assertions)]
    if development {
        // An imported, SHA-256-verified full runtime cache is usable on a
        // development machine without MSYS2, GStreamer installation or PATH setup.
        // This override does not exist in release builds. Keep runtime lookup
        // explicitly scoped to this child, never mutate the desktop app PATH.
        if let Some(root) = std::env::var_os("UXPLAY_DEV_GST_ROOT") {
            let runtime = PathBuf::from(root);
            let bin = runtime.join("bin");
            let plugins = runtime.join("lib").join("gstreamer-1.0");
            if !runtime.is_absolute() || !bin.is_dir() || !plugins.is_dir() {
                return Err("开发模式的 GStreamer 根目录缺少 bin 或 lib/gstreamer-1.0".into());
            }
            let mut paths = vec![bin.clone()];
            paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
            command.env("PATH", std::env::join_paths(paths).map_err(|_| "GStreamer PATH 无法构建")?);
            command.env("GST_PLUGIN_SYSTEM_PATH_1_0", "");
            command.env("GST_PLUGIN_SYSTEM_PATH", "");
            command.env("GST_PLUGIN_PATH_1_0", &plugins);
            command.env("GST_PLUGIN_PATH", &plugins);
            if let Some(scanner) = scanner_path(&runtime) {
                command.env("GST_PLUGIN_SCANNER_1_0", scanner);
            }
            #[cfg(target_os = "macos")]
            command.env("DYLD_LIBRARY_PATH", std::env::join_paths([runtime.join("lib"), bin]).map_err(|_| "GStreamer macOS 路径无效")?);
            return Ok(());
        }
        // A locally built MSYS2 UxPlay depends on MINGW64 DLLs outside the
        // project. This override is strictly debug-only; release uses staged assets.
        return Ok(());
    }
    let _ = development;
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let packaged = dir.join("gstreamer");
    #[cfg(debug_assertions)]
    let packaged = if packaged.join("bin").is_dir() { packaged }
        else { Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("gstreamer") };
    let bin = packaged.join("bin");
    let lib = packaged.join("lib");
    let plugins = lib.join("gstreamer-1.0");
    if !bin.is_dir() || !plugins.is_dir() {
        return Err("安装包缺少独立 GStreamer 运行时或插件；请使用完整打包的发行版本".into());
    }
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![bin.clone()];
    paths.extend(std::env::split_paths(&inherited));
    let new_path = std::env::join_paths(paths).map_err(|_| "GStreamer PATH 设置失败")?;
    command.env("PATH", new_path);
    command.env("GST_PLUGIN_SYSTEM_PATH_1_0", "");
    command.env("GST_PLUGIN_PATH_1_0", &plugins);
    command.env("GST_PLUGIN_SYSTEM_PATH", "");
    command.env("GST_PLUGIN_PATH", &plugins);
    if let Some(scanner) = scanner_path(&packaged) { command.env("GST_PLUGIN_SCANNER_1_0", scanner); }
    #[cfg(target_os="macos")]
    command.env("DYLD_LIBRARY_PATH", std::env::join_paths([lib, bin]).map_err(|_|"GStreamer dylib 搜索路径配置失败")?);
    #[cfg(target_os="linux")]
    command.env("LD_LIBRARY_PATH", std::env::join_paths([lib, bin]).map_err(|_|"GStreamer so 搜索路径配置失败")?);
    Ok(())
}
fn scanner_path(runtime: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) { "gst-plugin-scanner.exe" } else { "gst-plugin-scanner" };
    [runtime.join("bin").join(name), runtime.join("libexec").join("gstreamer-1.0").join(name)]
        .into_iter().find(|path| path.is_file())
}


#[cfg(target_os = "macos")]
fn setup_mac_video_controls(app: &AppHandle, command: &mut Command, development: bool) -> Result<(), String> {
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let shipped = resources.join("fullscreen").join("uxplay-fullscreen-macos.dylib");
    #[cfg(debug_assertions)]
    let shipped = if shipped.is_file() { shipped } else {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("fullscreen")
            .join("uxplay-fullscreen-macos.dylib")
    };
    if !shipped.is_file() {
        if development { return Ok(()); }
        return Err("安装包缺少 macOS 播放窗口标题原生扩展，请重新生成完整版安装包".into());
    }
    // Do not inherit untrusted DYLD_INSERT_LIBRARIES. Only the version built
    // into this installation is loaded, and only by this UxPlay child process.
    command.env("DYLD_INSERT_LIBRARIES", shipped);
    command.env("AIRPIMO_PLAYER_TITLE_CHILD", "1");
    Ok(())
}
