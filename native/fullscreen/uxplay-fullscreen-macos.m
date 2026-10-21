// UxPlay Desktop macOS video-window controls (inside the UxPlay child process).
// This library is inserted ONLY into the packaged UxPlay sidecar via DYLD_INSERT_LIBRARIES.
// No Accessibility permissions or system-wide event hooks are used.
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#import <dispatch/dispatch.h>

static char kUxOriginalFrame;
static char kUxOriginalStyle;
static char kUxFullscreenButton;

@interface UXVideoFullscreenControls : NSObject
@property(nonatomic, strong) id monitor;
@property(nonatomic, strong) dispatch_source_t timer;
@end

@implementation UXVideoFullscreenControls

- (BOOL)isControlledWindow:(NSWindow *)window {
    return window && objc_getAssociatedObject(window, &kUxFullscreenButton) != nil;
}

- (void)toggleWindow:(NSWindow *)window {
    if (![self isControlledWindow:window]) return;
    NSValue *oldFrame = objc_getAssociatedObject(window, &kUxOriginalFrame);
    NSNumber *oldStyle = objc_getAssociatedObject(window, &kUxOriginalStyle);
    if (oldFrame && oldStyle) {
        [window setStyleMask:(NSWindowStyleMask)oldStyle.unsignedLongLongValue];
        [window setFrame:oldFrame.rectValue display:YES animate:NO];
        objc_setAssociatedObject(window, &kUxOriginalFrame, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        objc_setAssociatedObject(window, &kUxOriginalStyle, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        return;
    }
    NSScreen *screen = window.screen ?: NSScreen.mainScreen;
    if (!screen) return;
    objc_setAssociatedObject(window, &kUxOriginalFrame,
                             [NSValue valueWithRect:window.frame], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, &kUxOriginalStyle,
                             @(window.styleMask), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    // Resize the EXISTING video window. Do not replace its GstGL video view,
    // GStreamer pipeline or AirPlay connection. Keep the renderer's aspect-ratio policy.
    [window setStyleMask:(window.styleMask & ~(NSWindowStyleMaskTitled |
                           NSWindowStyleMaskResizable | NSWindowStyleMaskClosable |
                           NSWindowStyleMaskMiniaturizable)) | NSWindowStyleMaskBorderless];
    [window setFrame:screen.frame display:YES animate:NO];
    [window makeKeyAndOrderFront:nil];
}

- (void)toggleFromButton:(NSButton *)button {
    [self toggleWindow:button.window];
}

- (void)attach:(NSWindow *)window {
    if (!window || !window.visible || [self isControlledWindow:window]) return;
    NSView *content = window.contentView;
    if (!content || window.frame.size.width < 100 || window.frame.size.height < 100) return;
    if (window.styleMask & NSWindowStyleMaskNonactivatingPanel) return;
    NSRect bounds = content.bounds;
    NSButton *button = [[NSButton alloc] initWithFrame:NSMakeRect(
        MAX(0, bounds.size.width - 42), MAX(0, bounds.size.height - 38), 34, 30)];
    [button setTitle:@"⛶"];
    [button setToolTip:@"全屏 / 恢复（双击画面切换，Esc 退出）"];
    button.bezelStyle = NSBezelStyleRounded;
    button.target = self;
    button.action = @selector(toggleFromButton:);
    button.autoresizingMask = NSViewMinXMargin | NSViewMinYMargin;
    [content addSubview:button positioned:NSWindowAbove relativeTo:nil];
    objc_setAssociatedObject(window, &kUxFullscreenButton, button, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

- (void)scan {
    // The injected library is loaded inside UxPlay, not the Tauri control window.
    // A GStreamer Cocoa video window may only be created after mirroring starts.
    for (NSWindow *window in NSApp.windows) [self attach:window];
}

- (void)start {
    __weak typeof(self) weakSelf = self;
    self.monitor = [NSEvent addLocalMonitorForEventsMatchingMask:
       (NSEventMaskLeftMouseDown | NSEventMaskKeyDown) handler:^NSEvent *(NSEvent *event) {
        typeof(self) selfRef = weakSelf;
        if (!selfRef || ![selfRef isControlledWindow:event.window]) return event;
        if (event.type == NSEventTypeKeyDown && event.keyCode == 53 &&
            objc_getAssociatedObject(event.window, &kUxOriginalFrame)) {
            [selfRef toggleWindow:event.window];
            return nil;
        }
        if (event.type == NSEventTypeLeftMouseDown && event.clickCount == 2) {
            NSButton *button = objc_getAssociatedObject(event.window, &kUxFullscreenButton);
            NSPoint point = [button convertPoint:event.locationInWindow fromView:nil];
            if (!NSPointInRect(point, button.bounds)) {
                [selfRef toggleWindow:event.window];
                return nil;
            }
        }
        return event;
    }];
    self.timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
                                       dispatch_get_main_queue());
    dispatch_source_set_timer(self.timer, DISPATCH_TIME_NOW,
                              350 * NSEC_PER_MSEC, 75 * NSEC_PER_MSEC);
    dispatch_source_set_event_handler(self.timer, ^{
        [weakSelf scan];
    });
    dispatch_resume(self.timer);
}
@end

__attribute__((constructor)) static void uxplayFullscreenInit(void) {
    // A separate child-process-only opt-in protects any executable that
    // accidentally gets this library inserted via an inherited environment.
    if (!getenv("UXPLAY_DESKTOP_FULLSCREEN_CHILD")) return;
    dispatch_async(dispatch_get_main_queue(), ^{
        static UXVideoFullscreenControls *controls;
        if (!controls) {
            controls = [UXVideoFullscreenControls new];
            [controls start];
        }
    });
}
