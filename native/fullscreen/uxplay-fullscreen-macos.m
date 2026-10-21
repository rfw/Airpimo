// Airpimo Player: title-only macOS video-window helper.
// Loaded only into the UxPlay child process, not the Tauri control window.
// The macOS-native green title-bar fullscreen button remains the only fullscreen UI.
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

@interface AirpimoVideoTitle : NSObject
@property(nonatomic, strong) dispatch_source_t timer;
@end
@implementation AirpimoVideoTitle
- (void)refreshVideoTitle {
    for (NSWindow *window in NSApp.windows) {
        if (!window.visible || window.frame.size.width < 120 || window.frame.size.height < 120) continue;
        if (!(window.styleMask & NSWindowStyleMaskTitled)) continue;
        if (window.styleMask & NSWindowStyleMaskNonactivatingPanel) continue;
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
    dispatch_async(dispatch_get_main_queue(), ^{
        static AirpimoVideoTitle *controller;
        if (!controller) { controller = [AirpimoVideoTitle new]; [controller start]; }
    });
}
