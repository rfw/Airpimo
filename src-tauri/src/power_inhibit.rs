//! Hold a native, process-owned idle-sleep/display-sleep inhibition only while
//! an AirPlay mirror is active. Dropping the guard restores OS power policy.
//! User-requested sleep, laptop lid closure, and critical battery/thermal
//! protection are deliberately not overridden.

pub(crate) struct PowerInhibitor(platform::PowerRequest);

impl PowerInhibitor {
    pub(crate) fn acquire() -> Result<Self, String> {
        platform::PowerRequest::acquire().map(Self)
    }
}

// Windows 7 SP1 and newer: native power requests, not SetThreadExecutionState
// (which would require keeping the same worker thread alive indefinitely).
#[cfg(windows)]
mod platform {
    use std::{ffi::c_void, io, os::windows::ffi::OsStrExt};

    type Handle = *mut c_void;
    const POWER_REQUEST_CONTEXT_VERSION: u32 = 0;
    const POWER_REQUEST_CONTEXT_SIMPLE_STRING: u32 = 1;
    const POWER_REQUEST_DISPLAY_REQUIRED: u32 = 0;
    const POWER_REQUEST_SYSTEM_REQUIRED: u32 = 1;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct DetailedReason {
        module: Handle,
        reason_id: u32,
        string_count: u32,
        strings: *const *const u16,
    }

    #[repr(C)]
    union Reason {
        detailed: DetailedReason,
        simple: *const u16,
    }

    #[repr(C)]
    struct ReasonContext {
        version: u32,
        flags: u32,
        reason: Reason,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn PowerCreateRequest(context: *const ReasonContext) -> Handle;
        fn PowerSetRequest(handle: Handle, kind: u32) -> i32;
        fn PowerClearRequest(handle: Handle, kind: u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    // Keep HANDLE as isize rather than a raw pointer so this guard can be
    // owned and released by different Controller threads behind a Mutex.
    pub(super) struct PowerRequest {
        handle: isize,
        display: bool,
        system: bool,
    }

    impl PowerRequest {
        pub(super) fn acquire() -> Result<Self, String> {
            let reason: Vec<u16> = std::ffi::OsStr::new("Airpimo: AirPlay screen mirroring")
                .encode_wide().chain(Some(0)).collect();
            let context = ReasonContext {
                version: POWER_REQUEST_CONTEXT_VERSION,
                flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                reason: Reason { simple: reason.as_ptr() },
            };
            let handle = unsafe { PowerCreateRequest(&context) };
            if handle.is_null() || handle as isize == -1 {
                return Err(format!("PowerCreateRequest failed: {}", io::Error::last_os_error()));
            }
            let mut request = Self { handle: handle as isize, display: false, system: false };
            if unsafe { PowerSetRequest(request.handle(), POWER_REQUEST_DISPLAY_REQUIRED) } == 0 {
                return Err(format!("PowerSetRequest(DISPLAY) failed: {}", io::Error::last_os_error()));
            }
            request.display = true;
            if unsafe { PowerSetRequest(request.handle(), POWER_REQUEST_SYSTEM_REQUIRED) } == 0 {
                return Err(format!("PowerSetRequest(SYSTEM) failed: {}", io::Error::last_os_error()));
            }
            request.system = true;
            Ok(request)
        }

        fn handle(&self) -> Handle { self.handle as Handle }
    }

    impl Drop for PowerRequest {
        fn drop(&mut self) {
            unsafe {
                if self.system { let _ = PowerClearRequest(self.handle(), POWER_REQUEST_SYSTEM_REQUIRED); }
                if self.display { let _ = PowerClearRequest(self.handle(), POWER_REQUEST_DISPLAY_REQUIRED); }
                let _ = CloseHandle(self.handle());
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{ffi::{c_char, c_void}, ptr};

    const UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8
    const ASSERTION_ON: u32 = 255; // kIOPMAssertionLevelOn

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            allocator: *const c_void, text: *const c_char, encoding: u32,
        ) -> *const c_void;
        fn CFRelease(value: *const c_void);
    }
    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: *const c_void, level: u32,
            name: *const c_void, assertion_id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(assertion_id: u32) -> i32;
    }

    struct CfString(*const c_void);
    impl CfString {
        fn new(text: &'static [u8]) -> Result<Self, String> {
            // Both literals below are NUL terminated UTF-8 without embedded NULs.
            let string = unsafe {
                CFStringCreateWithCString(ptr::null(), text.as_ptr().cast(), UTF8)
            };
            if string.is_null() { Err("CFStringCreateWithCString failed".into()) }
            else { Ok(Self(string)) }
        }
    }
    impl Drop for CfString {
        fn drop(&mut self) { unsafe { CFRelease(self.0) } }
    }

    pub(super) struct PowerRequest { assertion_id: u32 }
    impl PowerRequest {
        pub(super) fn acquire() -> Result<Self, String> {
            // The constant kIOPMAssertionTypePreventUserIdleDisplaySleep is
            // defined by Apple as CFSTR("PreventUserIdleDisplaySleep").
            let kind = CfString::new(b"PreventUserIdleDisplaySleep\0")?;
            let name = CfString::new(b"Airpimo: AirPlay screen mirroring\0")?;
            let mut assertion_id: u32 = 0;
            let status = unsafe {
                IOPMAssertionCreateWithName(kind.0, ASSERTION_ON, name.0, &mut assertion_id)
            };
            if status != 0 {
                return Err(format!("IOPMAssertionCreateWithName failed: IOReturn {status:#x}"));
            }
            Ok(Self { assertion_id })
        }
    }
    impl Drop for PowerRequest {
        fn drop(&mut self) { unsafe { let _ = IOPMAssertionRelease(self.assertion_id); } }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    pub(super) struct PowerRequest;
    impl PowerRequest {
        pub(super) fn acquire() -> Result<Self, String> {
            Err("Display wake inhibition is supported only on Windows and macOS".into())
        }
    }
}
