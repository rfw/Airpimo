
import { useI18n } from "../lib/i18n-react";
import { Smartphone, ScreenShare, Monitor, ChevronRight } from "lucide-react";

interface ScreenMirroringGuide {
    deviceName?: string;
}

export function ScreenMirroringGuide({
                                                 deviceName = "",
                                             }: ScreenMirroringGuide) {
    const { t } = useI18n();
    const iconClass = "h-[16px] w-[16px] text-blue-600 dark:text-blue-700";

    const iconWrapperClass =
        "flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 dark:bg-gray-800";

    return (
        <div className="w-full rounded-2xl border border-gray-100 dark:border-gray-700/50 px-2 py-2">
            <div className="grid grid-cols-[minmax(0,1fr)_12px_minmax(0,0.8fr)_12px_minmax(0,1.5fr)] items-center gap-1">
                {/* 第一步：打开控制中心 */}
                <div className="flex min-w-0 flex-col items-center gap-1">
                    <div className={iconWrapperClass}>
                        <Smartphone className={iconClass} strokeWidth={1.8} />
                    </div>
                    <span className="flex min-h-7 items-center justify-center text-center text-[11px] leading-[1.2] text-slate-600 dark:text-slate-500">
            {t('iPhone 控制中心')}
          </span>
                </div>

                <ChevronRight
                    className="h-3.5 w-3.5 text-slate-400"
                    strokeWidth={1.8}
                />

                {/* 第二步：选择屏幕镜像 */}
                <div className="flex min-w-0 flex-col items-center gap-1">
                    <div className={iconWrapperClass}>
                        <ScreenShare className={iconClass} strokeWidth={1.8} />
                    </div>
                    <span className="flex min-h-7 items-center justify-center text-center text-[11px] leading-[1.2] text-slate-600 dark:text-slate-500">
            {t('屏幕镜像')}
          </span>
                </div>

                <ChevronRight
                    className="h-3.5 w-3.5 text-slate-400"
                    strokeWidth={1.8}
                />

                {/* 第三步：选择接收设备 */}
                <div className="flex min-w-0 flex-col items-center gap-1">
                    <div className={iconWrapperClass}>
                        <Monitor className={iconClass} strokeWidth={1.8} />
                    </div>
                    <span
                        className="max-w-full truncate text-center text-[11px] font-medium text-slate-700 dark:text-slate-500"
                        title={deviceName}
                    >
            {deviceName}
          </span>
                </div>
            </div>
        </div>
    );
}
