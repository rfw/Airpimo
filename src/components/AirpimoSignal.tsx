
import { MonitorSmartphone } from "lucide-react";

interface AirpimoSignalProps {
    size?: number;
    animated?: boolean;
}

const rippleClass = `
  pointer-events-none
  absolute inset-[30%] z-[1]
  rounded-full
  border-[1.5px] border-blue-400/20
  shadow-[0_0_8px_rgba(59,130,246,0.12)]
  animate-[airpimo-water-ripple_4.8s_ease-out_infinite]
  motion-reduce:animate-none
  motion-reduce:opacity-0
`;

export function AirpimoSignal({
                                  size = 182,
                                  animated = true,
                              }: AirpimoSignalProps) {
    return (
        <div
            role="img"
            aria-label="Airpimo 投屏接收"
            className="
        relative isolate shrink-0
        overflow-hidden rounded-full
        bg-[radial-gradient(circle,#ffffff_0%,#f4f9ff_60%,#ffffff00_100%)]
        dark:bg-[radial-gradient(circle,#253449_0%,#192334_60%,#11182700_100%)]
      "
            style={{ width: size, height: size }}
        >
            {/* 浅蓝色背景圆 */}
            <div
                className="
          absolute inset-[13%] rounded-full
          border
          border-blue-200/25
          dark:border-blue-700/25
          bg-white/20
          dark:bg-black/10
        "
            />

            {/* 动态水波纹 */}
            {animated && (
                <>
                    <div className={rippleClass} />

                    <div
                        className={`${rippleClass} [animation-delay:-1.6s]`}
                    />

                    <div
                        className={`${rippleClass} [animation-delay:-3.2s]`}
                    />
                </>
            )}

            {/* 中心圆与图标 */}
            <div
                className="
          absolute inset-[29%] z-10
          flex items-center justify-center
          rounded-full
          border
          border-white/90
          dark:border-white/5
          bg-white/90
          dark:bg-white/5
          shadow-[0_3px_16px_rgba(70,134,225,0.08)]
        "
            >
                <MonitorSmartphone
                    className="size-[52%] text-blue-500"
                    strokeWidth={2.2}
                />
            </div>
        </div>
    );
}
