// Airpimo Player: macOS video-window title and close-lifecycle guard.
// Loaded only into the UxPlay child process, not the Tauri control window.
// The macOS-native green title-bar fullscreen button remains the only fullscreen UI.
// On user Close, hide the window rather than destroying the GL-backed surface
// while UxPlay continues to render on a separate RAOP thread. This is a
// defensive workaround, not a fix for arbitrary upstream UxPlay crashes.
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>
#import <unistd.h>

// Only UxPlay's own player window is affected. No global event monitoring,
// no Tauri or other-process window modifications.
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
        // performClose: is the macOS standard close-button / Cmd-W path.
        // orderOut: preserves the GL surface and pipeline for the active
        // receiver session; destroying them here races UxPlay's video thread.
        [self orderOut:nil];
        static const char note[] = "AIRPIMO_PLAYER_WINDOW_HIDDEN\n";
        (void)write(STDOUT_FILENO, note, sizeof(note) - 1);
        return;
    }
    [self airpimo_playerPerformClose:sender]; // original implementation after swizzle
}
@end

static void airpimoInstallSafeClose(void) {
    Method original = class_getInstanceMethod([NSWindow class], @selector(performClose:));
    Method guarded = class_getInstanceMethod([NSWindow class], @selector(airpimo_playerPerformClose:));
    if (original && guarded) method_exchangeImplementations(original, guarded);
}

@interface AirpimoVideoTitle : NSObject
@property(nonatomic, strong) dispatch_source_t timer;
@end
@implementation AirpimoVideoTitle
- (void)refreshVideoTitle {
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
    airpimoInstallSafeClose();
    dispatch_async(dispatch_get_main_queue(), ^{
        static AirpimoVideoTitle *controller;
        if (!controller) { controller = [AirpimoVideoTitle new]; [controller start]; }
    });
}
