// Airpimo Player: macOS player-window title, safe-close, and accessory-app guard.
// Injected only into the Airpimo-managed UxPlay child process (never Tauri).
// UxPlay/GStreamer owns the NSApplication and video window lifetime.
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>
#import <unistd.h>

static BOOL airpimoIsVideoWindow(NSWindow *window) {
    if (!window || window.frame.size.width < 120 || window.frame.size.height < 120) return NO;
    if (!(window.styleMask & NSWindowStyleMaskTitled)) return NO;
    NSString *title = window.title;
    return [title isEqualToString:@"Airpimo Player"] ||
           [title isEqualToString:@"OpenGL renderer"];
}

@interface NSWindow (AirpimoPlayerClose)
- (void)airpimo_playerPerformClose:(id)sender;
@end
@implementation NSWindow (AirpimoPlayerClose)
- (void)airpimo_playerPerformClose:(id)sender {
    if (airpimoIsVideoWindow(self)) {
        // Keep the live GL surface intact; closing it while RAOP renders can crash.
        [self orderOut:nil];
        static const char note[] = "AIRPIMO_PLAYER_WINDOW_HIDDEN\n";
        (void)write(STDOUT_FILENO, note, sizeof(note) - 1);
        return;
    }
    [self airpimo_playerPerformClose:sender]; // Swizzled original.
}
@end

static void airpimoInstallSafeClose(void) {
    Method original = class_getInstanceMethod([NSWindow class], @selector(performClose:));
    Method guarded = class_getInstanceMethod([NSWindow class], @selector(airpimo_playerPerformClose:));
    if (original && guarded) method_exchangeImplementations(original, guarded);
}

// GStreamer-GL's Cocoa window creation calls
//   [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular]
// each time it creates its own window. Setting Accessory only on a periodic
// timer allows that call to re-register UxPlay in Dock and the application
// menu. Prevent this *in the child process* before Cocoa initializes.
// Unlike Prohibited, Accessory still allows visible, interactive NSWindows.
@interface NSApplication (AirpimoChildActivation)
- (BOOL)airpimo_childSetActivationPolicy:(NSApplicationActivationPolicy)policy;
@end
@implementation NSApplication (AirpimoChildActivation)
- (BOOL)airpimo_childSetActivationPolicy:(NSApplicationActivationPolicy)policy {
    if (policy == NSApplicationActivationPolicyRegular) {
        static dispatch_once_t noticeOnce;
        dispatch_once(&noticeOnce, ^{
            static const char note[] = "AIRPIMO_DOCK_REGULAR_BLOCKED\n";
            (void)write(STDERR_FILENO, note, sizeof(note) - 1);
        });
        // A caller that wants Regular just needs a window; Accessory supports
        // this without a Dock entry or a child-process menu bar.
        if ([self activationPolicy] == NSApplicationActivationPolicyAccessory) return YES;
        policy = NSApplicationActivationPolicyAccessory;
    }
    // After swizzling this invokes the original AppKit implementation.
    return [self airpimo_childSetActivationPolicy:policy];
}
@end

static void airpimoInstallDockGuard(void) {
    Method original = class_getInstanceMethod([NSApplication class], @selector(setActivationPolicy:));
    Method guarded = class_getInstanceMethod([NSApplication class], @selector(airpimo_childSetActivationPolicy:));
    if (original && guarded) {
        method_exchangeImplementations(original, guarded);
        static const char note[] = "AIRPIMO_DOCK_GUARD_INSTALLED\n";
        (void)write(STDERR_FILENO, note, sizeof(note) - 1);
    } else {
        static const char note[] = "AIRPIMO_DOCK_GUARD_FAILED\n";
        (void)write(STDERR_FILENO, note, sizeof(note) - 1);
    }
}

@interface AirpimoVideoTitle : NSObject
@property(nonatomic, strong) dispatch_source_t timer;
@property(nonatomic, assign) BOOL dockPolicyApplied;
@property(nonatomic, assign) BOOL dockPolicyFailureReported;
@end
@implementation AirpimoVideoTitle
- (void)refreshVideoTitle {
    // This is the AppKit main queue. Never create NSApplication manually;
    // gst_macos_main owns its initialization and event loop.
    if (!NSApp) return;
    if ([NSApp activationPolicy] != NSApplicationActivationPolicyAccessory) {
        BOOL changed = [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        BOOL active = changed && ([NSApp activationPolicy] == NSApplicationActivationPolicyAccessory);
        if (active && !self.dockPolicyApplied) {
            static const char note[] = "AIRPIMO_DOCK_ACCESSORY_ACTIVE\n";
            (void)write(STDERR_FILENO, note, sizeof(note) - 1);
        }
        if (!active && !self.dockPolicyFailureReported) {
            static const char note[] = "AIRPIMO_DOCK_ACCESSORY_FAILED\n";
            (void)write(STDERR_FILENO, note, sizeof(note) - 1);
            self.dockPolicyFailureReported = YES;
        }
        self.dockPolicyApplied = active;
    }
    for (NSWindow *window in NSApp.windows) {
        if (!window.visible || !airpimoIsVideoWindow(window)) continue;
        if (![window.title isEqualToString:@"Airpimo Player"]) window.title = @"Airpimo Player";
    }
}
- (void)start {
    __weak typeof(self) weakSelf = self;
    self.timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(self.timer, DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC, 100 * NSEC_PER_MSEC);
    dispatch_source_set_event_handler(self.timer, ^{ [weakSelf refreshVideoTitle]; });
    dispatch_resume(self.timer);
}
@end

__attribute__((constructor)) static void airpimoVideoTitleInit(void) {
    if (!getenv("AIRPIMO_PLAYER_TITLE_CHILD")) return;
    // Swizzle before GStreamer's Cocoa window creation, not after the first
    // frame or after the first attempt to promote UxPlay into Dock.
    airpimoInstallSafeClose();
    airpimoInstallDockGuard();
    dispatch_async(dispatch_get_main_queue(), ^{
        static AirpimoVideoTitle *controller;
        if (!controller) { controller = [AirpimoVideoTitle new]; [controller start]; }
    });
}
