use crate::{diagnostic::{self, Observation}, power_inhibit::PowerInhibitor, settings::{self, Settings, Theme}};
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

// The tray offers Stop while the engine exists OR its start is in progress.
// A failed/exited engine with no child offers Start, even during backoff.
fn tray_should_stop(stage: &str, process_running: bool) -> bool {
    process_running || stage == "starting"
}
// A spawned receiver or a successful TCP connection alone is NOT mirroring.
// Only the actual mirror-start event may acquire a display wake assertion.
fn should_keep_display_awake(stage: &str, process_running: bool, stopping: bool) -> bool {
    stage == "connected" && process_running && !stopping
}
fn should_rearm_closed_player(stage: &str, process_running: bool, stopping: bool) -> bool {
    stage == "connected" && process_running && !stopping
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
    applied_uxplay_args: Option<String>,
    process_running: bool,
    discovery_verified: bool,
    audio_verified: bool,
    connected_since: Option<u64>,
    restart_attempts: u8,
    #[cfg(debug_assertions)]
    simulated: bool,
    settings: Settings,
}
struct Inner {
    settings: Settings,
    stage: &'static str,
    detail: String,
    issue: Option<&'static str>,
    child: Option<Child>,
    #[cfg(windows)]
    receiver_job: Option<crate::windows_job::ReceiverJob>,
    epoch: u64,
    stopping: bool,
    restart_attempts: u8,
    applied_device_name: Option<String>,
    applied_fps: Option<u16>,
    applied_uxplay_args: Option<String>,
    connected_since: Option<u64>,
    started_at: Option<Instant>,
    connecting_at: Option<Instant>,
    logs: VecDeque<String>,
    power_inhibitor: Option<PowerInhibitor>,
    #[cfg(debug_assertions)]
    simulation: Option<DevSimulation>,
    #[cfg(debug_assertions)]
    simulation_pending: bool,
}
#[cfg(debug_assertions)]
struct DevSimulation {
    child: Child,
    resume_receiver: bool,
    #[cfg(windows)]
    job: crate::windows_job::ReceiverJob,
}

impl Inner {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            stage: self.stage, detail: self.detail.clone(), issue: self.issue,
            device_name: self.settings.device_name.clone(), applied_device_name: self.applied_device_name.clone(),
            applied_fps: self.applied_fps,
            applied_uxplay_args: self.applied_uxplay_args.clone(),
            process_running: {
                #[cfg(debug_assertions)] { self.child.is_some() || self.simulation.is_some() }
                #[cfg(not(debug_assertions))] { self.child.is_some() }
            }, discovery_verified: false, audio_verified: false,
            connected_since: self.connected_since, restart_attempts: self.restart_attempts,
            #[cfg(debug_assertions)]
            simulated: self.simulation.is_some(),
            settings: self.settings.clone(),
        }
    }
    fn log(&mut self, key: &str) {
        if self.logs.len() >= LOG_LIMIT { self.logs.pop_front(); }
        self.logs.push_back(format!("{} | {}", unix_now(), key));
    }
    fn sync_display_awake(&mut self) {
        #[cfg(debug_assertions)]
        let running = self.child.is_some() || self.simulation.is_some();
        #[cfg(not(debug_assertions))]
        let running = self.child.is_some();
        if !should_keep_display_awake(self.stage, running, self.stopping) {
            // Drop releases both Windows power requests or the macOS IOKit assertion.
            self.power_inhibitor = None;
        } else if self.power_inhibitor.is_none() {
            match PowerInhibitor::acquire() {
                Ok(guard) => { self.power_inhibitor = Some(guard); self.log("display_awake_acquired"); }
                Err(err) => {
                    // Mirroring must remain available even if OS power management fails.
                    self.log("display_awake_acquire_failed");
                    eprintln!("Airpimo could not inhibit idle display sleep: {err}");
                }
            }
        }
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
            #[cfg(windows)] receiver_job:None,
            epoch:0, stopping:true, restart_attempts:0, applied_device_name:None, applied_fps:None, applied_uxplay_args:None,
            connected_since:None, started_at:None, connecting_at:None, logs, power_inhibitor:None,
            #[cfg(debug_assertions)] simulation:None,
            #[cfg(debug_assertions)] simulation_pending:false,
        }), settings_path })
    }
    pub fn settings(&self) -> Settings { self.inner.lock().unwrap().settings.clone() }
    pub fn snapshot(&self) -> Snapshot { self.inner.lock().unwrap().snapshot() }
    pub(crate) fn tray_should_stop(&self) -> bool {
        let inner = self.inner.lock().unwrap();
        #[cfg(debug_assertions)]
        let running = inner.child.is_some() || inner.simulation.is_some();
        #[cfg(not(debug_assertions))]
        let running = inner.child.is_some();
        tray_should_stop(inner.stage, running)
    }
    fn publish(&self, app: &AppHandle) {
        // Reconcile the OS power assertion before publishing every lifecycle
        // change; this also covers manual stop, disconnect, errors, restart and
        // unexpected child exit without frontend involvement or polling.
        self.inner.lock().unwrap().sync_display_awake();
        crate::sync_tray_receiver_item(app);
        let _ = app.emit("receiver://snapshot", self.snapshot());
    }
    fn error(&self, app: &AppHandle, epoch: u64, issue: &'static str, message: &str) {
        { let mut inner = self.inner.lock().unwrap(); if inner.epoch != epoch || inner.stopping { return; } inner.stage="error"; inner.detail=message.to_owned(); inner.issue=Some(issue); inner.log(issue); }
        self.publish(app);
    }
    pub fn save_settings(self: &Arc<Self>, app: &AppHandle, mut next: Settings) -> Result<Snapshot,String> {
        settings::validate_name(&next.device_name)?;
        settings::validate_fps(next.fps)?;
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
    // Persist only the appearance field. No receiver stop/start, args update or
    // unrelated draft configuration can be committed by this IPC.
    pub fn set_theme(self: &Arc<Self>, app: &AppHandle, theme: Theme) -> Result<Snapshot,String> {
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.settings.theme == theme { return Ok(inner.snapshot()); }
            let mut next = inner.settings.clone();
            next.theme = theme;
            // Write first so a failed disk operation does not change live state.
            settings::save(&self.settings_path, &next)?;
            inner.settings = next;
            inner.log("appearance_saved");
        }
        self.publish(app);
        Ok(self.snapshot())
    }
    // Persist the close-button policy without committing any unsaved receiver settings.
    // This is a UI lifecycle preference; changing it never restarts UxPlay.
    pub fn set_stay_in_tray(self: &Arc<Self>, app: &AppHandle, stay_in_tray: bool) -> Result<Snapshot,String> {
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.settings.stay_in_tray == stay_in_tray { return Ok(inner.snapshot()); }
            let mut next = inner.settings.clone();
            next.stay_in_tray = stay_in_tray;
            settings::save(&self.settings_path, &next)?;
            inner.settings = next;
            inner.log("tray_preference_saved");
        }
        self.publish(app);
        Ok(self.snapshot())
    }
    pub fn diagnostics(&self) -> String {
        let inner = self.inner.lock().unwrap();
        format!("AIRPIMO / LOCAL DIAGNOSTICS\nGenerated Unix time: {}\nStatus: {}\nProcess running: {}\nDiscovery externally verified: false\nAudio externally verified: false\nRecovery attempts: {}\nDevice name intentionally omitted from log\n\n{}\n",
            unix_now(), inner.stage, {
                #[cfg(debug_assertions)] { inner.child.is_some() || inner.simulation.is_some() }
                #[cfg(not(debug_assertions))] { inner.child.is_some() }
            }, inner.restart_attempts,
            inner.logs.iter().cloned().collect::<Vec<_>>().join("\n"))
    }
    // Only compiled in development builds. Launch the same GStreamer window
    // stack as the real receiver, without opening an AirPlay network port.
    // The real receiver is temporarily stopped and restored when the demo ends.
    #[cfg(debug_assertions)]
    pub fn start_simulation(self: &Arc<Self>, app: &AppHandle) -> Result<Snapshot, String> {
        let (path, development) = simulation_gst_launch(app)?;
        let mut command = Command::new(path);
        command.args(["-q", "videotestsrc", "is-live=true", "pattern=ball",
            "!", "videoconvert", "!", "autovideosink"])
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        setup_gstreamer(app, &mut command, development)?;
        #[cfg(target_os = "macos")]
        setup_mac_video_controls(app, &mut command, true)?;
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let resume = {
            let mut i = self.inner.lock().unwrap();
            if i.simulation.is_some() || i.simulation_pending {
                return Err("模拟投屏已在运行或启动中".into());
            }
            if i.stage == "connected" || i.stage == "connecting" {
                return Err("请先断开真实投屏连接，再启动模拟测试".into());
            }
            i.simulation_pending = true;
            i.child.is_some() || i.stage == "starting"
        };
        // Keep the launch reservation while stopping the real receiver;
        // another tray/UI Start must not race between stop and the demo spawn.
        self.stop_internal(app, true);
        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(err) => {
                self.simulation_failed(app, resume);
                return Err(format!("无法启动 GStreamer 测试播放器：{err}。请检查 gst-launch-1.0 是否已安装"));
            }
        };
        #[cfg(windows)]
        let job = match crate::windows_job::ReceiverJob::attach(&child) {
            Ok(job) => job,
            Err(err) => {
                let _ = child.kill(); let _ = child.wait();
                self.simulation_failed(app, resume);
                return Err(format!("无法托管模拟播放器进程：{err}"));
            }
        };
        let pid = child.id();
        let output = child.stdout.take();
        {
            let mut i = self.inner.lock().unwrap();
            i.simulation = Some(DevSimulation {
                child, resume_receiver: resume,
                #[cfg(windows)] job,
            });
            i.simulation_pending = false;
            i.stopping = false;
            i.stage = "connected";
            i.detail = "开发测试：模拟投屏中（未连接 AirPlay）".into();
            i.connected_since = Some(unix_now());
            i.issue = None;
            i.log("dev_simulated_mirror_started");
        }
        self.publish(app);
        #[cfg(windows)] {
            let owner = self.clone(); let app_clone = app.clone();
            crate::windows_player::watch(pid, move || {
                owner.stop_simulation_for_pid(&app_clone, pid);
                true
            });
        }
        if let Some(output) = output {
            let owner = self.clone(); let app_clone = app.clone();
            thread::spawn(move || {
                for line in BufReader::new(output).lines() {
                    if matches!(line, Ok(ref value) if value.trim() == "AIRPIMO_PLAYER_WINDOW_HIDDEN") {
                        owner.stop_simulation_for_pid(&app_clone, pid);
                        break;
                    }
                }
            });
        }
        {
            let owner = self.clone(); let app_clone = app.clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(250));
                let exited = {
                    let mut i = owner.inner.lock().unwrap();
                    match i.simulation.as_mut() {
                        Some(sim) if sim.child.id() == pid =>
                            match sim.child.try_wait() { Ok(Some(_)) | Err(_) => true, _ => false },
                        _ => return,
                    }
                };
                if exited { owner.stop_simulation_for_pid(&app_clone, pid); return; }
            });
        }
        Ok(self.snapshot())
    }
    #[cfg(debug_assertions)]
    fn simulation_failed(self: &Arc<Self>, app: &AppHandle, resume: bool) {
        self.inner.lock().unwrap().simulation_pending = false;
        if resume { self.start(app, true); }
    }
    #[cfg(debug_assertions)]
    fn stop_simulation_for_pid(self: &Arc<Self>, app: &AppHandle, pid: u32) -> Snapshot {
        let simulation = {
            let mut i = self.inner.lock().unwrap();
            if i.simulation.as_ref().map(|sim| sim.child.id()) != Some(pid) {
                return i.snapshot();
            }
            let sim = i.simulation.take().unwrap();
            i.stage = "stopped";
            i.stopping = true;
            i.detail = "模拟投屏已结束".into();
            i.connected_since = None;
            i.power_inhibitor = None;
            i.log("dev_simulated_mirror_ended");
            sim
        };
        let resume = simulation.resume_receiver;
        let mut child = simulation.child;
        let _ = child.kill(); let _ = child.wait();
        #[cfg(windows)]
        drop(simulation.job);
        self.publish(app);
        if resume { self.start(app, true) } else { self.snapshot() }
    }
    #[cfg(debug_assertions)]
    pub fn stop_simulation(self: &Arc<Self>, app: &AppHandle) -> Snapshot {
        let pid = self.inner.lock().unwrap().simulation.as_ref().map(|s| s.child.id());
        match pid { Some(pid) => self.stop_simulation_for_pid(app, pid), None => self.snapshot() }
    }
    pub fn stop(self: &Arc<Self>, app: &AppHandle) -> Snapshot {
        self.stop_internal(app, false)
    }
    fn stop_internal(self: &Arc<Self>, app: &AppHandle, preserve_sim_pending: bool) -> Snapshot {
        #[cfg(not(debug_assertions))]
        let _ = preserve_sim_pending;
        let (child, receiver_job, simulation) = {
            let mut i=self.inner.lock().unwrap();
            i.stopping=true; i.epoch+=1; i.stage="stopped"; i.detail="接收服务已停止".into();
            i.issue=None; i.connected_since=None; i.connecting_at=None; i.applied_device_name=None; i.applied_fps=None; i.applied_uxplay_args=None; i.restart_attempts=0;
            i.log("stopped_by_user"); i.power_inhibitor = None;
            #[cfg(windows)] let job=i.receiver_job.take();
            #[cfg(not(windows))] let job=();
            #[cfg(debug_assertions)] let sim = i.simulation.take();
            #[cfg(not(debug_assertions))] let sim = ();
            #[cfg(debug_assertions)] if !preserve_sim_pending { i.simulation_pending = false; }
            (i.child.take(),job,sim)
        };
        if let Some(mut child) = child { let _ = child.kill(); let _ = child.wait(); }
        #[cfg(debug_assertions)]
        if let Some(mut sim) = simulation { let _ = sim.child.kill(); let _ = sim.child.wait(); }
        #[cfg(not(debug_assertions))]
        let _ = simulation;
        #[cfg(windows)]
        drop(receiver_job); // Close the Job Object after the receiver exits.
        #[cfg(not(windows))]
        let _ = receiver_job;
        self.publish(app);
        self.snapshot()
    }
    pub fn retry(self: &Arc<Self>, app: &AppHandle) -> Snapshot {
        self.stop(app);
        self.start(app, true)
    }
    pub fn start(self: &Arc<Self>, app: &AppHandle, reset_backoff: bool) -> Snapshot {
        let (epoch, name, fps, user_args) = {
            let mut i=self.inner.lock().unwrap();
            #[cfg(debug_assertions)]
            if i.simulation.is_some() || i.simulation_pending { return i.snapshot(); }
            if start_already_in_progress(i.child.is_some(), i.stopping, i.stage) { return i.snapshot(); }
            i.stopping=false;
            if reset_backoff { i.restart_attempts=0; }
            i.epoch+=1; i.stage="starting"; i.detail="正在启动 UxPlay…".into(); i.issue=None;
            i.connected_since=None; i.connecting_at=None; i.started_at=Some(Instant::now()); i.applied_device_name=None; i.applied_fps=None; i.applied_uxplay_args=None;
            i.log("starting_receiver"); (i.epoch, i.settings.device_name.clone(), i.settings.fps, i.settings.uxplay_args.clone())
        };
        self.publish(app);
        let (binary, dev_binary) = match sidecar_path(app) {
            Ok(path)=>path,
            Err(err)=>{ self.error(app,epoch,"missing_binary",&err); return self.snapshot(); }
        };
        // GUI settings always win, then expert parameters, then built-in defaults.
        let effective_args = match crate::uxplay_args::effective(&name, fps, &user_args) {
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
        // Fail closed: never run an unmanaged Windows receiver. Windows 7 does
        // not support nested jobs; report that environment incompatibility.
        #[cfg(windows)]
        let job = match crate::windows_job::ReceiverJob::attach(&child) {
            Ok(job)=>job,
            Err(err)=>{
                let _=child.kill(); let _=child.wait();
                self.error(app,epoch,"missing_runtime",&format!("Windows 无法托管 UxPlay 进程树：{err}"));
                return self.snapshot();
            }
        };
        let receiver_pid = child.id();
        let stdout=child.stdout.take(); let stderr=child.stderr.take();
        {
            let mut i=self.inner.lock().unwrap();
            if i.epoch != epoch || i.stopping { let _=child.kill(); let _=child.wait(); return i.snapshot(); }
            #[cfg(windows)] { i.receiver_job=Some(job); }
            i.child=Some(child); i.applied_device_name=Some(name); i.applied_fps=Some(fps); i.applied_uxplay_args=Some(user_args);
            if dev_binary { i.log("development_local_binary_unbundled_gstreamer"); }
            i.log("sidecar_spawned_discovery_unverified");
        }
        self.publish(app);
        // Watch after the child is committed to the controller. Never treat a
        // transiently missing renderer during startup as an active close.
        #[cfg(windows)] {
            let owner = self.clone();
            let app_clone = app.clone();
            crate::windows_player::watch(receiver_pid, move || {
                owner.player_window_closed(&app_clone, epoch)
            });
        }
        #[cfg(not(windows))]
        let _ = receiver_pid;
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
    // A native player window is gone but UxPlay may remain alive without
    // emitting a mirroring teardown line. A stale "connected" stage would keep
    // the display awake indefinitely and lie to the UI. Re-arm this receiver
    // from its one authoritative controller; reject events from a previous PID
    // or epoch, and never restart for a window lost after mirror teardown.
    fn player_window_closed(self: &Arc<Self>, app: &AppHandle, epoch: u64) -> bool {
        let allowed = {
            let i = self.inner.lock().unwrap();
            i.epoch == epoch && should_rearm_closed_player(i.stage, i.child.is_some(), i.stopping)
        };
        if !allowed { return false; }
        {
            let mut i = self.inner.lock().unwrap();
            if i.epoch != epoch || !should_rearm_closed_player(i.stage, i.child.is_some(), i.stopping) { return false; }
            i.log("player_window_closed_rearming_receiver");
        }
        self.retry(app);
        true
    }
    fn observe(self: &Arc<Self>, app:&AppHandle, epoch:u64, line:&str) {
        // The macOS helper intercepts close BEFORE the GL surface is destroyed.
        // Preserve the safe stop path while re-arming discovery for the next
        // screen-mirroring session (the main Airpimo window stays open).
        if line.trim() == "AIRPIMO_PLAYER_WINDOW_HIDDEN" {
            let _ = self.player_window_closed(app, epoch);
            return;
        }
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
            i.power_inhibitor = None; i.child.take();
            #[cfg(windows)] { i.receiver_job.take(); }
            i.connected_since=None; i.connecting_at=None; i.applied_device_name=None; i.applied_fps=None; i.applied_uxplay_args=None;
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
    use super::{consume_lines, should_keep_display_awake, start_already_in_progress, tray_should_stop};
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
    fn tray_receiver_action_covers_all_lifecycle_states() {
        assert!(!tray_should_stop("stopped", false));
        assert!(tray_should_stop("starting", false));
        assert!(tray_should_stop("waiting", true));
        assert!(tray_should_stop("connecting", true));
        assert!(tray_should_stop("connected", true));
        assert!(tray_should_stop("error", true));
        assert!(!tray_should_stop("error", false));
        assert!(!tray_should_stop("waiting", false));
    }

    #[test]
    fn display_awake_requires_real_mirroring_and_live_child() {
        for stage in ["stopped", "starting", "waiting", "connecting", "error"] {
            assert!(!should_keep_display_awake(stage, true, false));
        }
        assert!(!should_keep_display_awake("connected", false, false));
        assert!(!should_keep_display_awake("connected", true, true));
        assert!(should_keep_display_awake("connected", true, false));
    }

    #[test]
    fn player_close_only_rearms_active_mirroring() {
        assert!(should_rearm_closed_player("connected", true, false));
        for stage in ["starting", "waiting", "connecting", "stopped", "error"] {
            assert!(!should_rearm_closed_player(stage, true, false));
        }
        assert!(!should_rearm_closed_player("connected", false, false));
        assert!(!should_rearm_closed_player("connected", true, true));
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
#[cfg(debug_assertions)]
fn simulation_gst_launch(app: &AppHandle) -> Result<(PathBuf, bool), String> {
    let name = if cfg!(windows) { "gst-launch-1.0.exe" } else { "gst-launch-1.0" };
    if let Some(requested) = std::env::var_os("AIRPIMO_DEV_GST_LAUNCH") {
        let path = PathBuf::from(requested);
        if !path.is_absolute() || !path.is_file() {
            return Err("AIRPIMO_DEV_GST_LAUNCH 必须是现有 gst-launch-1.0 的绝对路径".into());
        }
        return Ok((path, true));
    }
    if let Some(root) = std::env::var_os("UXPLAY_DEV_GST_ROOT") {
        let path = PathBuf::from(root).join("bin").join(name);
        if path.is_file() { return Ok((path, true)); }
    }
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    for root in [resources, Path::new(env!("CARGO_MANIFEST_DIR")).join("resources")] {
        let path = root.join("gstreamer").join("bin").join(name);
        if path.is_file() { return Ok((path, false)); }
    }
    // Developer-installed GStreamer (e.g. Homebrew) is allowed only in debug.
    Ok((PathBuf::from(name), true))
}

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
    #[cfg(windows)] let filename = "AirpimoPlayer.exe";
    #[cfg(target_os = "macos")] let filename = "Airpimo Player";
    #[cfg(all(not(windows), not(target_os = "macos")))] let filename = "uxplay";
    let path = dir.join("sidecar").join(filename);
    if path.is_file() { return Ok((path, false)); }
    #[cfg(debug_assertions)] {
        let local = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources").join("sidecar").join(filename);
        if local.is_file() { return Ok((local, false)); }
        #[cfg(windows)] {
            // Legacy cache is only accepted in debug builds. Shipping must be branded.
            let legacy = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources").join("sidecar").join("uxplay.exe");
            if legacy.is_file() { return Ok((legacy, false)); }
        }
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
        if development {
            return Err("开发模式缺少 macOS 播放器安全关闭扩展；请使用 npm run desktop:dev 重新生成原生辅助库".into());
        }
        return Err("安装包缺少 macOS 播放窗口标题原生扩展，请重新生成完整版安装包".into());
    }
    // Do not inherit untrusted DYLD_INSERT_LIBRARIES. Only the version built
    // into this installation is loaded, and only by this UxPlay child process.
    command.env("DYLD_INSERT_LIBRARIES", shipped);
    command.env("AIRPIMO_PLAYER_TITLE_CHILD", "1");
    Ok(())
}
