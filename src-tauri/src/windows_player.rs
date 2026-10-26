//! Windows 7/10/11 UxPlay video-window presentation controls.
//! No DLL injection, global keyboard/mouse hook, shell command, or new renderer.
//! Operates only on visible top-level windows owned by this exact child PID.
#![cfg(windows)]
use std::{mem::size_of, os::windows::ffi::OsStrExt, thread, time::{Duration, Instant}};
use std::ffi::OsStr;

type Hwnd = isize;
type Handle = isize;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Point { x: i32, y: i32 }
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
#[repr(C)]
struct MonitorInfo { cb_size: u32, rc_monitor: Rect, rc_work: Rect, flags: u32 }

#[link(name = "user32")]
extern "system" {
    fn EnumWindows(callback: unsafe extern "system" fn(Hwnd, isize) -> i32, data: isize) -> i32;
    fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
    fn IsWindowVisible(hwnd: Hwnd) -> i32;
    fn IsWindow(hwnd: Hwnd) -> i32;
    fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
    fn SetWindowTextW(hwnd: Hwnd, title: *const u16) -> i32;
    fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
    fn GetClientRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
    fn ClientToScreen(hwnd: Hwnd, point: *mut Point) -> i32;
    fn GetCursorPos(point: *mut Point) -> i32;
    fn GetForegroundWindow() -> Hwnd;
    fn GetAsyncKeyState(vkey: i32) -> i16;
    fn GetDoubleClickTime() -> u32;
    fn IsZoomed(hwnd: Hwnd) -> i32;
    fn ShowWindow(hwnd: Hwnd, command: i32) -> i32;
    fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
    fn SetWindowLongPtrW(hwnd: Hwnd, index: i32, value: isize) -> isize;
    fn SetWindowPos(hwnd: Hwnd, after: Hwnd, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
    fn MonitorFromWindow(hwnd: Hwnd, flags: u32) -> Handle;
    fn GetMonitorInfoW(monitor: Handle, info: *mut MonitorInfo) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
    fn WaitForSingleObject(handle: Handle, millis: u32) -> u32;
    fn CloseHandle(handle: Handle) -> i32;
}

const GWL_STYLE: i32 = -16;
const WS_CAPTION: isize = 0x00c0_0000;
const WS_SYSMENU: isize = 0x0008_0000;

const WS_MAXIMIZEBOX: isize = 0x0001_0000;
const WS_THICKFRAME: isize = 0x0004_0000;
const WS_OVERLAPPEDWINDOW: isize = 0x00cf_0000;
const WS_POPUP: isize = 0x8000_0000u32 as isize;
const SWP_FRAMECHANGED: u32 = 0x0020;
const SWP_NOZORDER: u32 = 0x0004;
const SWP_NOACTIVATE: u32 = 0x0010;
const SW_RESTORE: i32 = 9;
const WAIT_TIMEOUT: u32 = 0x102;
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
const SYNCHRONIZE: u32 = 0x0010_0000;

#[derive(Clone, Copy)]
struct Search { pid: u32, result: Hwnd }
unsafe extern "system" fn find_video_window(hwnd: Hwnd, opaque: isize) -> i32 {
    let search = &mut *(opaque as *mut Search);
    let mut process = 0u32;
    GetWindowThreadProcessId(hwnd, &mut process);
    if process != search.pid || IsWindowVisible(hwnd) == 0 || GetWindowTextLengthW(hwnd) <= 0 {
        return 1;
    }
    let mut rect = Rect::default();
    if GetWindowRect(hwnd, &mut rect) == 0 || rect.right - rect.left < 220 || rect.bottom - rect.top < 160 {
        return 1;
    }
    search.result = hwnd;
    0
}
fn video_window(pid: u32) -> Hwnd {
    let mut search = Search { pid, result: 0 };
    unsafe { EnumWindows(find_video_window, (&mut search as *mut Search) as isize); }
    search.result
}

#[derive(Clone, Copy)]
struct Windowed { style: isize, rect: Rect }
fn set_title_and_maximize_button(hwnd: Hwnd) {
    let title: Vec<u16> = OsStr::new("Airpimo Player").encode_wide().chain(Some(0)).collect();
    unsafe {
        SetWindowTextW(hwnd, title.as_ptr());
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        // Windows only draws the maximize caption button if BOTH WS_CAPTION
        // and WS_SYSMENU are present. Keep an ordinary caption (not TOOLWINDOW).
        let desired = style | WS_CAPTION | WS_SYSMENU | WS_MAXIMIZEBOX | WS_THICKFRAME;
        if style != desired {
            SetWindowLongPtrW(hwnd, GWL_STYLE, desired);
            SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE | 0x0001 | 0x0002);
        }
    }
}
fn toggle(hwnd: Hwnd, current: &mut Option<Windowed>) {
    unsafe {
        if let Some(previous) = current.take() {
            SetWindowLongPtrW(hwnd, GWL_STYLE, previous.style);
            SetWindowPos(hwnd, 0, previous.rect.left, previous.rect.top,
                previous.rect.right - previous.rect.left, previous.rect.bottom - previous.rect.top,
                SWP_FRAMECHANGED | SWP_NOZORDER);
            return;
        }
        if IsZoomed(hwnd) != 0 { ShowWindow(hwnd, SW_RESTORE); }
        let mut rect = Rect::default();
        if GetWindowRect(hwnd, &mut rect) == 0 { return; }
        let monitor = MonitorFromWindow(hwnd, 2);
        if monitor == 0 { return; }
        let mut info = MonitorInfo { cb_size: size_of::<MonitorInfo>() as u32,
            rc_monitor: Rect::default(), rc_work: Rect::default(), flags: 0 };
        if GetMonitorInfoW(monitor, &mut info) == 0 { return; }
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        SetWindowLongPtrW(hwnd, GWL_STYLE, (style & !WS_OVERLAPPEDWINDOW) | WS_POPUP);
        let target = info.rc_monitor;
        if SetWindowPos(hwnd, 0, target.left, target.top, target.right - target.left,
                target.bottom - target.top, SWP_FRAMECHANGED | SWP_NOZORDER) != 0 {
            *current = Some(Windowed { style, rect });
        } else {
            SetWindowLongPtrW(hwnd, GWL_STYLE, style);
        }
    }
}
fn pointer_in_video_content(hwnd: Hwnd, cursor: Point) -> bool {
    unsafe {
        let mut bounds = Rect::default();
        let mut top_left = Point::default();
        if GetClientRect(hwnd, &mut bounds) == 0 || ClientToScreen(hwnd, &mut top_left) == 0 { return false; }
        cursor.x >= top_left.x && cursor.x < top_left.x + bounds.right &&
        cursor.y >= top_left.y && cursor.y < top_left.y + bounds.bottom
    }
}

/// Call after the child has been spawned; thread exits automatically when its PID exits.
/// Observes mouse edges only while the *child video window* is foreground.
pub fn watch(child_pid: u32, mut on_closed: impl FnMut() -> bool + Send + 'static) {
    thread::spawn(move || {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, child_pid) };
        if process == 0 { return; }
        let mut hwnd: Hwnd = 0;
        let mut saw_video_window = false;
        let mut window_missing_since: Option<Instant> = None;
        let mut fullscreen: Option<Windowed> = None;
        let mut mouse_was_down = false;
        let mut esc_was_down = false;
        let mut last_title = Instant::now() - Duration::from_secs(5);
        let mut last_click: Option<(Instant, Point)> = None;
        let double_click_ms = unsafe { GetDoubleClickTime() as u64 };
        while unsafe { WaitForSingleObject(process, 28) } == WAIT_TIMEOUT {
            let candidate = if hwnd != 0 && unsafe { IsWindow(hwnd) } != 0 { hwnd } else { video_window(child_pid) };
            if candidate != hwnd {
                hwnd = candidate;
                fullscreen = None;
                last_click = None;
                last_title = Instant::now() - Duration::from_secs(5);
            }
            if hwnd != 0 && unsafe { IsWindow(hwnd) } != 0 {
                saw_video_window = true;
                window_missing_since = None;
            } else {
                // A destroyed video HWND is not the same as a minimized or
                // temporarily hidden window. Allow renderer replacement while
                // the phone rotates before reporting a real close. Only the
                // controller may decide whether mirroring is still connected.
                if saw_video_window {
                    let elapsed = window_missing_since.get_or_insert_with(Instant::now).elapsed();
                    if elapsed >= Duration::from_millis(800) {
                        if on_closed() { break; }
                        saw_video_window = false;
                        window_missing_since = None;
                    }
                }
                continue;
            }
            if fullscreen.is_none() && last_title.elapsed() >= Duration::from_millis(1200) {
                set_title_and_maximize_button(hwnd);
                last_title = Instant::now();
            }
            let active = unsafe { GetForegroundWindow() } == hwnd;
            let mouse_down = unsafe { GetAsyncKeyState(0x01) } < 0;
            let esc_down = unsafe { GetAsyncKeyState(0x1b) } < 0;
            if active {
                // Native caption maximize button becomes an actual borderless fullscreen toggle.
                if fullscreen.is_none() && unsafe { IsZoomed(hwnd) } != 0 { toggle(hwnd, &mut fullscreen); }
                let mut point = Point::default();
                if mouse_down && !mouse_was_down && unsafe { GetCursorPos(&mut point) } != 0 && pointer_in_video_content(hwnd, point) {
                    if let Some((when, previous)) = last_click {
                        if when.elapsed() <= Duration::from_millis(double_click_ms) &&
                            (point.x - previous.x).abs() <= 8 && (point.y - previous.y).abs() <= 8 {
                            toggle(hwnd, &mut fullscreen);
                            last_click = None;
                        } else { last_click = Some((Instant::now(), point)); }
                    } else { last_click = Some((Instant::now(), point)); }
                }
                if fullscreen.is_some() && esc_down && !esc_was_down { toggle(hwnd, &mut fullscreen); }
            } else { last_click = None; }
            mouse_was_down = mouse_down;
            esc_was_down = esc_down;
        }
        unsafe { CloseHandle(process); }
    });
}
