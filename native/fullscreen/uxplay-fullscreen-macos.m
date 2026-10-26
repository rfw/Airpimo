// Airpimo Player macOS helper, loaded only in the managed UxPlay child.
// This changes process presentation, never the parent Tauri application.
#import <Cocoa/Cocoa.h>
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

// Let GStreamer register the player as a regular macOS application so its
// own Dock item and the video window remain visible. Only the child process
// is branded; Airpimo's main Tauri window and activation policy are untouched.

@interface AirpimoVideoTitle : NSObject
@property(nonatomic, strong) dispatch_source_t timer;
@end
@implementation AirpimoVideoTitle
- (void)refreshVideoTitle {
    // All AppKit and Process Manager calls happen on the main queue.
    if (!NSApp) return;
    // Keep the Dock/app-menu identity consistent with the visible video window.
    if (![[[NSProcessInfo processInfo] processName] isEqualToString:@"Airpimo Player"]) {
        [[NSProcessInfo processInfo] setProcessName:@"Airpimo Player"];
    }
    if ([NSApp activationPolicy] != NSApplicationActivationPolicyRegular) {
        (void)[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    }
    if (NSApp.mainMenu.numberOfItems > 0) {
        NSMenuItem *applicationItem = [NSApp.mainMenu itemAtIndex:0];
        if (![applicationItem.title isEqualToString:@"Airpimo Player"]) {
            applicationItem.title = @"Airpimo Player";
        }
    }

    for (NSWindow *window in NSApp.windows) {
        if (!window.visible || !airpimoIsVideoWindow(window)) continue;
        if (![window.title isEqualToString:@"Airpimo Player"]) window.title = @"Airpimo Player";

        // Preserve native macOS fullscreen. Without FullScreenPrimary the green
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
    // Closing a video window must still notify the parent safely.
    airpimoInstallSafeClose();
    dispatch_async(dispatch_get_main_queue(), ^{
        static AirpimoVideoTitle *controller;
        if (!controller) { controller = [AirpimoVideoTitle new]; [controller start]; }
    });
}
