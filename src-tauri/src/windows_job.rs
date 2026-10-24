//! Own the Windows receiver process tree. A Job Object with KILL_ON_JOB_CLOSE
//! terminates UxPlay (and any descendants) even when Airpimo is force-killed.
//! Windows 7 supports this limit; don't rely on post-exit Rust callbacks.
use std::{ffi::c_void, io, mem::size_of, os::windows::io::AsRawHandle, process::Child, ptr::null_mut};

type Handle = *mut c_void;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

#[repr(C)]
#[derive(Default)]
struct BasicLimits {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}
#[repr(C)]
#[derive(Default)]
struct IoCounters {
    read_operation_count: u64,
    write_operation_count: u64,
    other_operation_count: u64,
    read_transfer_count: u64,
    write_transfer_count: u64,
    other_transfer_count: u64,
}
#[repr(C)]
#[derive(Default)]
struct ExtendedLimits {
    basic: BasicLimits,
    io: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[link(name = "kernel32")]
extern "system" {
    fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
    fn SetInformationJobObject(job: Handle, info_class: i32, info: *const c_void, len: u32) -> i32;
    fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
}

pub struct ReceiverJob(Handle);
// Only the owning controller (protected by Mutex) moves and drops this OS handle.
unsafe impl Send for ReceiverJob {}

impl ReceiverJob {
    pub fn attach(child: &Child) -> io::Result<Self> {
        let raw = unsafe { CreateJobObjectW(null_mut(), null_mut()) };
        if raw.is_null() { return Err(io::Error::last_os_error()); }
        let job = Self(raw);
        let mut info = ExtendedLimits::default();
        info.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = unsafe {
            SetInformationJobObject(job.0, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                (&info as *const ExtendedLimits).cast(), size_of::<ExtendedLimits>() as u32)
        };
        if ok == 0 { return Err(io::Error::last_os_error()); }
        let ok = unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle() as Handle) };
        if ok == 0 { return Err(io::Error::last_os_error()); }
        Ok(job)
    }
}
impl Drop for ReceiverJob {
    fn drop(&mut self) { unsafe { CloseHandle(self.0); } }
}
