// Airpimo Player macOS helper, loaded only in the managed UxPlay child.
// This changes process presentation, never the parent Tauri application.
#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>
#import <stdio.h>
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
        // GStreamer still owns the GL surface. Destroying it during rendering
        // can crash UxPlay; let the parent receiver stop the child instead.
        [self orderOut:nil];
        static const char note[] = "AIRPIMO_PLAYER_WINDOW_HIDDEN\n";
        (void)write(STDOUT_FILENO, note, sizeof(note) - 1);
        return;
    }
    [self airpimo_playerPerformClose:sender];
}
@end

static void airpimoInstallSafeClose(void) {
    Method original = class_getInstanceMethod([NSWindow class], @selector(performClose:));
    Method guarded = class_getInstanceMethod([NSWindow class], @selector(airpimo_playerPerformClose:));
    if (original && guarded) method_exchangeImplementations(original, guarded);
}

// gstglwindow_cocoa.m explicitly requests Regular when creating its window.
// Prevent this promotion before the video window is created. Accessory is
// intentional: Prohibited would break window activation and input.
@interface NSApplication (AirpimoChildActivation)
- (BOOL)airpimo_childSetActivationPolicy:(NSApplicationActivationPolicy)policy;
@end
@implementation NSApplication (AirpimoChildActivation)
- (BOOL)airpimo_childSetActivationPolicy:(NSApplicationActivationPolicy)policy {
    if (policy == NSApplicationActivationPolicyRegular) {
        static dispatch_once_t once;
        dispatch_once(&once, ^{
            static const char note[] = "AIRPIMO_DOCK_REGULAR_BLOCKED\n";
            (void)write(STDERR_FILENO, note, sizeof(note) - 1);
        });
        if ([self activationPolicy] == NSApplicationActivationPolicyAccessory) return YES;
        policy = NSApplicationActivationPolicyAccessory;
    }
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

// NSApplication's policy getter is not necessarily the Launch Services process
// registration state. Query NSRunningApplication independently and, in addition
// to AppKit, use Apple's Process Manager UIElement transition as a bounded
// fallback. Never transform the process to Prohibited or Foreground.
static OSStatus airpimoRequestUIElement(void) {
    ProcessSerialNumber psn = {0, kCurrentProcess};
    return TransformProcessType(&psn, kProcessTransformToUIElementApplication);
}

@interface AirpimoVideoTitle : NSObject
@property(nonatomic, strong) dispatch_source_t timer;
@property(nonatomic, assign) NSUInteger transformAttempts;
@property(nonatomic, assign) NSUInteger ticks;
@property(nonatomic, assign) NSInteger lastAppKitPolicy;
@property(nonatomic, assign) NSInteger lastRunningPolicy;
@property(nonatomic, assign) BOOL hasLoggedState;
@property(nonatomic, assign) BOOL hasLoggedAccessory;
@property(nonatomic, assign) BOOL hasLoggedFailure;
@end
@implementation AirpimoVideoTitle
- (void)refreshVideoTitle {
    // All AppKit and Process Manager calls happen on the main queue.
    if (!NSApp) return;
    self.ticks++;

    // Process/menu naming is a fallback only; hiding the Dock and app menu is
    // still the priority. This prevents a remaining menu from saying "uxplay".
    if (![[[NSProcessInfo processInfo] processName] isEqualToString:@"Airpimo Player"]) {
        [[NSProcessInfo processInfo] setProcessName:@"Airpimo Player"];
    }

    if ([NSApp activationPolicy] != NSApplicationActivationPolicyAccessory) {
        (void)[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    }

    NSRunningApplication *running = [NSRunningApplication currentApplication];
    NSApplicationActivationPolicy appPolicy = [NSApp activationPolicy];
    NSApplicationActivationPolicy runningPolicy = running.activationPolicy;

    // One early OS-level registration attempt, plus at most two retries if
    // Launch Services still sees a foreground application. Retry no faster
    // than once per second; never re-register continuously every 500ms.
    if (self.transformAttempts < 3 &&
        (self.transformAttempts == 0 ||
         (runningPolicy == NSApplicationActivationPolicyRegular && self.ticks % 2 == 0))) {
        self.transformAttempts++;
        OSStatus status = airpimoRequestUIElement();
        char note[128];
        int size = snprintf(note, sizeof(note), "AIRPIMO_DOCK_TRANSFORM status=%ld attempt=%lu\n",
                            (long)status, (unsigned long)self.transformAttempts);
        if (size > 0 && size < (int)sizeof(note)) (void)write(STDERR_FILENO, note, (size_t)size);
    }

    appPolicy = [NSApp activationPolicy];
    runningPolicy = [running activationPolicy];
    if (!self.hasLoggedState || appPolicy != self.lastAppKitPolicy ||
        runningPolicy != self.lastRunningPolicy) {
        self.hasLoggedState = YES;
        self.lastAppKitPolicy = appPolicy;
        self.lastRunningPolicy = runningPolicy;
        char note[128];
        int size = snprintf(note, sizeof(note), "AIRPIMO_DOCK_STATE appkit=%ld running=%ld\n",
                            (long)appPolicy, (long)runningPolicy);
        if (size > 0 && size < (int)sizeof(note)) (void)write(STDERR_FILENO, note, (size_t)size);
    }

    if (appPolicy == NSApplicationActivationPolicyAccessory &&
        runningPolicy == NSApplicationActivationPolicyAccessory) {
        if (!self.hasLoggedAccessory) {
            static const char note[] = "AIRPIMO_DOCK_ACCESSORY_ACTIVE\n";
            (void)write(STDERR_FILENO, note, sizeof(note) - 1);
            self.hasLoggedAccessory = YES;
        }
    } else if (self.transformAttempts >= 3 && !self.hasLoggedFailure) {
        static const char note[] = "AIRPIMO_DOCK_ACCESSORY_FAILED\n";
        (void)write(STDERR_FILENO, note, sizeof(note) - 1);
        self.hasLoggedFailure = YES;
    }

    // If macOS keeps UxPlay registered as a regular app, at least stop the
    // application menu caption from exposing the internal engine name.
    if (runningPolicy == NSApplicationActivationPolicyRegular && NSApp.mainMenu.numberOfItems > 0) {
        NSMenuItem *applicationItem = [NSApp.mainMenu itemAtIndex:0];
        if (![applicationItem.title isEqualToString:@"Airpimo Player"]) {
            applicationItem.title = @"Airpimo Player";
        }
    }

    for (NSWindow *window in NSApp.windows) {
        if (!window.visible || !airpimoIsVideoWindow(window)) continue;
        if (![window.title isEqualToString:@"Airpimo Player"]) window.title = @"Airpimo Player";

        // An Accessory (Dock-less) application does not always opt its windows
        // into native macOS fullscreen. Without FullScreenPrimary the green
        // traffic-light falls back to Zoom, leaving the Dock/menu bar visible.
        // Keep the system button and its native transition; do not swizzle
        // the Zoom selector, replace the button, or resize the GStreamer GL surface here.
        NSWindowCollectionBehavior current = window.collectionBehavior;
        NSWindowCollectionBehavior desired =
            (current & ~(NSWindowCollectionBehaviorFullScreenAuxiliary |
                         NSWindowCollectionBehaviorFullScreenNone |
                         NSWindowCollectionBehaviorCanJoinAllSpaces)) |
            NSWindowCollectionBehaviorFullScreenPrimary;
        if (desired != current) window.collectionBehavior = desired;
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
    // The selector guard must exist before GStreamer initializes Cocoa.
    airpimoInstallSafeClose();
    airpimoInstallDockGuard();
    dispatch_async(dispatch_get_main_queue(), ^{
        static AirpimoVideoTitle *controller;
        if (!controller) { controller = [AirpimoVideoTitle new]; [controller start]; }
    });
}
