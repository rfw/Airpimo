import {
  ClipboardCopy,
  LoaderCircle,
  MonitorSmartphone,
  Play,
  Settings,
  Square,
} from "lucide-react";
import { brand } from "../brand";
import { type Snapshot, showRestartPrompt, issueHint } from "../domain/state";
import { homeStatus } from "../domain/home-status";
import { isDesktop } from "../lib/desktop";

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
  const macOS = isMacOS();
  const active = snapshot.process_running;
  const baseName = active
    ? snapshot.applied_device_name ?? snapshot.settings.device_name
    : snapshot.settings.device_name;
  const name = `${baseName.replace(/@Airpimo$/, "")}@Airpimo`;
  const status = homeStatus(snapshot, ready, bootError, now);
  const starting = snapshot.stage === "starting";
  const retry = snapshot.stage === "error" && !active;
  const disabled = !ready || busy || starting || !isDesktop();
  const label = active ? "停止接收" : "开始接收";
  const onPrimaryAction = active ? onStop : retry ? onRetry : onStart;
  const serviceError = Boolean(bootError) || snapshot.stage === "error";
  const restartNeeded = showRestartPrompt(snapshot);
  const feedbackIsError = feedback !== "" && feedback !== "复制成功";
  // All transient successes, failures, pending-restart and receiver states live in the footer.
  // Service failures take precedence over a stale "copied" notification.
  const statusLabel = serviceError
    ? status.label
    : feedback || (restartNeeded ? "设置已修改 · 点击重启生效" : status.label);
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
      ? issueHint(snapshot.issue, import.meta.env.DEV)
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
      className={`app-shell airpimo-root ${
        macOS ? "airpimo-macos" : "airpimo-windows"
      }`}
      aria-busy={!ready}
    >
      {macOS && (
        <header className="airpimo-header" data-tauri-drag-region>
          <span className="airpimo-header-title" data-tauri-drag-region>
            {brand.appName}
          </span>
        </header>
      )}

      <main className="airpimo-content">
        <div className="airpimo-center">
          <div className="airpimo-hero" aria-hidden="true">
            <div className="airpimo-hero-inner">
              <MonitorSmartphone size={40} strokeWidth={1.85} />
            </div>
          </div>
          <section className="airpimo-device" aria-label="投屏设备名称">
            <span className="airpimo-device-label">投屏设备名称</span>
            <div className="airpimo-device-row">
              <strong className="airpimo-device-name" title={name}>
                {name}
              </strong>
              <button
                className="airpimo-copy"
                type="button"
                aria-label="复制投屏设备名称"
                title="复制设备名称"
                onClick={() => onCopy(name)}
              >
                <ClipboardCopy size={16} strokeWidth={1.9} />
              </button>
            </div>
          </section>
          <button
            className={`airpimo-primary ${active ? "is-stop" : ""}`}
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
        <p
          className="airpimo-guide"
          title={`iPhone 控制中心 → 屏幕镜像 → ${name}`}
        >
          iPhone 控制中心 <span aria-hidden="true">→</span> 屏幕镜像{" "}
          <span aria-hidden="true">→</span>{" "}
          <span className="airpimo-guide-device">{name}</span>
        </p>
      </main>

      <footer className="airpimo-footer">
        <div
          className="airpimo-status"
          role="status"
          aria-live={statusTone === "error" ? "assertive" : "polite"}
          title={fullStatus}
        >
          <span
            className={`airpimo-status-dot is-${statusTone}`}
            aria-hidden="true"
          />
          {canRestart ? (
            <button
              type="button"
              className="airpimo-status-text airpimo-status-action"
              onClick={onRetry}
              title={fullStatus}
            >
              {statusLabel}
            </button>
          ) : canDismiss ? (
            <button
              type="button"
              className="airpimo-status-text airpimo-status-action"
              onClick={onClearFeedback}
              title={`${fullStatus} · 点击关闭消息`}
            >
              {statusLabel}
            </button>
          ) : (
            <span className="airpimo-status-text">{statusLabel}</span>
          )}
        </div>
        <div className="airpimo-footer-actions">
          <span className="airpimo-version">v{brand.version}</span>
          <span className="airpimo-separator" aria-hidden="true" />
          <button
            type="button"
            className="airpimo-footer-button"
            aria-label="打开设置"
            title={updateAvailable ? "设置 · 发现新版本" : "设置"}
            disabled={!ready || !isDesktop()}
            onClick={onSettings}
          >
            <Settings size={16} strokeWidth={1.8} />
            {updateAvailable && (
              <span className="airpimo-update-dot" aria-label="发现新版本" />
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
