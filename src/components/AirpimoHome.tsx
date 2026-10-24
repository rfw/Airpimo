import {
  ClipboardCopy,
  LoaderCircle,
  Play,
  Settings,
  Square,
} from "lucide-react";
import { useI18n } from "../lib/i18n-react";
import { translate } from "../lib/i18n";
import { brand } from "../brand";
import { type Snapshot, showRestartPrompt, issueHint } from "../domain/state";
import { homeStatus } from "../domain/home-status";
import { isDesktop } from "../lib/desktop";
import { AirpimoSignal } from "./AirpimoSignal";
import { ScreenMirroringGuide } from "./ScreenMirroringGuide";

export interface AirpimoHomeProps {
  snapshot: Snapshot;
  ready: boolean;
  busy: boolean;
  now: number;
  bootError: string;
  feedback: string;
  onStart(): void;
  onStop(): void;
  onRetry(): void;
  onCopy(name: string): void;
  onSettings(): void;
  updateAvailable: boolean;
  onClearFeedback(): void;
}

/** Only used to decide whether the web Header is shown; no runtime services depend on UA. */
function isMacOS() {
  if (typeof navigator === "undefined") return false;
  return /Macintosh|Mac OS X/i.test(navigator.userAgent);
}

export function AirpimoHome({
  snapshot,
  ready,
  busy,
  now,
  bootError,
  feedback,
  onStart,
  onStop,
  onRetry,
  onCopy,
  onSettings,
  onClearFeedback,
  updateAvailable,
}: AirpimoHomeProps) {
  const { t, language } = useI18n();
  const macOS = isMacOS();
  const active = snapshot.process_running;
  const baseName = active
    ? snapshot.applied_device_name ?? snapshot.settings.device_name
    : snapshot.settings.device_name;
  const name = `${baseName.replace(/@Airpimo$/, "")}@Airpimo`;
  const status = homeStatus(snapshot, ready, bootError, now, language);
  const starting = snapshot.stage === "starting";
  const retry = snapshot.stage === "error" && !active;
  const disabled = !ready || busy || starting || !isDesktop();
  const label = active ? t("停止接收") : t("开始接收");
  const onPrimaryAction = active ? onStop : retry ? onRetry : onStart;
  const serviceError = Boolean(bootError) || snapshot.stage === "error";
  const restartNeeded = showRestartPrompt(snapshot);
  const feedbackIsError = feedback !== "" && feedback !== "复制成功" && feedback !== "诊断日志已导出";
  // All transient successes, failures, pending-restart and receiver states live in the footer.
  // Service failures take precedence over a stale "copied" notification.
  const statusLabel = serviceError
    ? status.label
    : translate(feedback, language) || (restartNeeded ? t("设置已修改 · 点击重启生效") : status.label);
  const statusTone = serviceError
    ? status.tone
    : feedback
      ? feedbackIsError
        ? "error"
        : "success"
      : restartNeeded
        ? "warning"
        : status.tone;
  const diagnosticHint =
    snapshot.stage === "error"
      ? t(issueHint(snapshot.issue, import.meta.env.DEV))
      : "";
  const fullStatus = [statusLabel, status.details, diagnosticHint]
    .filter(Boolean)
    .join(" · ");
  const canRestart =
    restartNeeded &&
    !serviceError &&
    !feedback &&
    !busy &&
    ready &&
    isDesktop();
  const canDismiss = Boolean(feedback) && !serviceError;

  return (
    <div
      className="flex h-screen max-h-screen min-h-0 w-full flex-col overflow-hidden bg-background text-foreground"
      aria-busy={!ready}
    >
      {macOS && (
        <header className="relative flex h-[46px] min-h-[46px] select-none items-center justify-center border-b border-border" data-tauri-drag-region>
          <span className="pointer-events-none text-sm font-[640] tracking-[-0.25px]" data-tauri-drag-region>
            {brand.appName}
          </span>
        </header>
      )}

      <main className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-3 pt-2.5">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-around">
          <AirpimoSignal size={220} animated={active} />

          <div className="flex flex-col items-center gap-0">
            <section className="flex w-[min(100%,370px)] min-w-0 flex-col items-center text-center" aria-label={t("投屏设备名称")}>
              <span className="text-xs font-[450] text-muted-foreground">{t('投屏设备名称')}</span>
              <div className="mt-1 flex max-w-full min-w-0 items-center justify-center gap-1.5 pl-7">
                <strong className="min-w-0 max-w-[min(270px,calc(100vw-120px))] truncate text-[20px] font-[660] leading-[1.3] tracking-[-0.35px]" title={name}>
                  {name}
                </strong>
                <button
                  className="grid size-7 shrink-0 place-items-center rounded-[7px] border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                  type="button"
                  aria-label={t("复制投屏设备名称")}
                  title={t("复制设备名称")}
                  onClick={() => onCopy(name)}
                >
                  <ClipboardCopy size={16} strokeWidth={1.9} />
                </button>
              </div>
            </section>
            <button
              className={`mt-5 inline-flex h-[38px] min-w-[140px] items-center justify-center gap-[9px] rounded-full border border-[#247df1] bg-[#1677fb] px-[17px] text-[13px] font-[550] text-[#eaeaea] shadow-[0_3px_9px_rgba(23,116,243,0.15)] transition-[background-color,transform] duration-150 hover:enabled:bg-[#086aea] active:enabled:translate-y-px disabled:cursor-default disabled:opacity-55 motion-reduce:transition-none ${active ? "!border-[#246fe8] !bg-[#246fe8] !text-white hover:enabled:!bg-[#155ed4]" : ""}`}
              type="button"
              onClick={onPrimaryAction}
              disabled={disabled}
              aria-label={label}
            >
              {busy || starting ? (
                <LoaderCircle
                  className="animate-spin"
                  size={16}
                  aria-hidden="true"
                />
              ) : active ? (
                <Square size={14} fill="currentColor" aria-hidden="true" />
              ) : (
                <Play size={17} fill="currentColor" aria-hidden="true" />
              )}
              <span>{label}</span>
            </button>
          </div>

          <div className="w-full">
            <ScreenMirroringGuide deviceName={name} />
          </div>

        </div>
      </main>

      <footer className="flex h-[50px] min-h-[50px] shrink-0 items-center justify-between gap-2 border-t border-border bg-background px-[17px]">
        <div
          className="flex min-w-0 flex-1 items-center gap-[9px] text-xs text-foreground"
          role="status"
          aria-live={statusTone === "error" ? "assertive" : "polite"}
          title={fullStatus}
        >
          <span
            className={`block size-[9px] shrink-0 rounded-full ${statusTone === "success" ? "bg-[#16c75b]" : statusTone === "warning" ? "bg-[#e6a334]" : statusTone === "error" ? "bg-[#e4474b]" : "bg-[#a4adbb]"}`}
            aria-hidden="true"
          />
          {canRestart ? (
            <button
              type="button"
              className="min-w-0 truncate cursor-pointer border-0 bg-transparent py-[3px] text-left font-[inherit] text-inherit hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1677fb]"
              onClick={onRetry}
              title={fullStatus}
            >
              {statusLabel}
            </button>
          ) : canDismiss ? (
            <button
              type="button"
              className="min-w-0 truncate cursor-pointer border-0 bg-transparent py-[3px] text-left font-[inherit] text-inherit hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1677fb]"
              onClick={onClearFeedback}
              title={`${fullStatus} · ${t("点击关闭消息")}`}
            >
              {statusLabel}
            </button>
          ) : (
            <span className="min-w-0 truncate">{statusLabel}</span>
          )}
        </div>
        <div className="inline-flex shrink-0 items-center gap-[9px]">
          <span className="text-[11px] tabular-nums text-muted-foreground">v{brand.version}</span>
          <span className="h-[19px] w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            className="relative grid h-7 w-[26px] place-items-center rounded-[7px] border-0 bg-transparent p-0 text-muted-foreground hover:enabled:bg-muted hover:enabled:text-foreground disabled:opacity-45"
            aria-label={t("打开设置")}
            title={updateAvailable ? t("设置 · 发现新版本") : t("设置")}
            disabled={!ready || !isDesktop()}
            onClick={onSettings}
          >
            <Settings size={16} strokeWidth={1.8} />
            {updateAvailable && (
              <span className="absolute right-px top-px size-1.5 rounded-full bg-[#3986ee]" aria-label={t("发现新版本")} />
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
