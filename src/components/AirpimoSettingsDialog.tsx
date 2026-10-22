import type { Dispatch, SetStateAction } from "react";
import { X } from "lucide-react";
import { brand } from "../brand";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import type { Settings, ThemeChoice } from "../domain/state";
import type { ReleaseStatus } from "../lib/release-update";

export type SettingsTab = "config" | "theme" | "updates" | "diagnostics";

interface SettingsDialogProps {
  settingsOpen: boolean;
  setSettingsOpen(value: boolean): void;
  settingsTab: SettingsTab;
  chooseTab(tab: SettingsTab): void;
  draft: Settings;
  setDraft: Dispatch<SetStateAction<Settings>>;
  saveSettings(): Promise<void>;
  formError: string;
  actionBusy: boolean;
  updateResult: ReleaseStatus | null;
  updateChecking: boolean;
  runUpdateCheck(): Promise<void>;
  openRelease(): Promise<void>;
  releaseOpening: boolean;
  diagnostics: string;
  loadDiagnostics(): Promise<void>;
  exportDiagnostics(): Promise<void>;
  diagnosticsExportStatus: string;
  diagnosticsExporting: boolean;
}

function useDialogPosition() {
  const dialogMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
  const dialogClass = `!fixed !inset-0 !left-0 !top-0 z-50 !m-0 flex !h-screen !max-h-none !min-h-0 !w-screen !min-w-0 !max-w-none !translate-x-0 !translate-y-0 flex-col overflow-hidden !rounded-none px-[18px] pb-3 pt-[14px] !shadow-none [@media(max-height:390px)]:px-3 [@media(max-height:390px)]:pb-2 [@media(max-height:390px)]:pt-2.5 ${dialogMac ? "!top-[46px] !h-[calc(100vh-46px)] [@media(max-height:390px)]:!top-[42px] [@media(max-height:390px)]:!h-[calc(100vh-42px)]" : ""}`;
  const overlayClass = `fixed inset-0 z-40 bg-transparent ${dialogMac ? "top-[46px] [@media(max-height:390px)]:top-[42px]" : ""}`;

  return { dialogMac, dialogClass, overlayClass };
}

export function AirpimoSettingsDialog({
                                        settingsOpen,
                                        setSettingsOpen,
                                        settingsTab,
                                        chooseTab,
                                        draft,
                                        setDraft,
                                        saveSettings,
                                        formError,
                                        actionBusy,
                                        updateResult,
                                        updateChecking,
                                        runUpdateCheck,
                                        openRelease,
                                        releaseOpening,
                                        diagnostics,
                                        loadDiagnostics,
                                        exportDiagnostics,
                                        diagnosticsExportStatus,
                                        diagnosticsExporting,
                                      }: SettingsDialogProps) {
  const { dialogClass, overlayClass } = useDialogPosition();
  const panelClass =
      "min-h-0 flex-1 overflow-y-auto overscroll-contain px-[4px] pb-5 pt-4 scroll-p-4";

  // HTML's `hidden` can be overridden by Tailwind display utilities (e.g. flex).
  // Keep aria-controls targets mounted and force inactive panels off-screen.
  const panelClasses = (tab: SettingsTab, extra = "") =>
      `${panelClass} ${settingsTab === tab ? "" : "!hidden"} ${extra}`;

  return (
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className={dialogClass} overlayClassName={overlayClass}>
          <div className="mb-[9px] flex shrink-0 items-start justify-between">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-[9px] gap-y-1">
              <DialogTitle className="text-[15px] font-[650] leading-[1.3]">
                设置
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-muted-foreground">
                Airpimo · 配置与维护
              </DialogDescription>
            </div>
            <button
                aria-label="关闭设置"
                className="inline-flex items-center justify-center border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setSettingsOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          <div
              className="grid shrink-0 grid-cols-4 gap-1 border-b border-border pb-2"
              role="tablist"
              aria-label="设置选项卡"
          >
            {(
                [
                  ["config", "配置"],
                  ["theme", "主题"],
                  ["updates", "升级"],
                  ["diagnostics", "诊断"],
                ] as const
            ).map(([value, label]) => (
                <button
                    key={value}
                    type="button"
                    id={`airpimo-tab-${value}`}
                    role="tab"
                    aria-controls={`airpimo-panel-${value}`}
                    aria-selected={settingsTab === value}
                    tabIndex={settingsTab === value ? 0 : -1}
                    onClick={() => chooseTab(value)}
                    className="whitespace-nowrap rounded-[7px] border-0 bg-transparent px-0.5 py-2 text-xs font-semibold text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary [@media(max-height:390px)]:py-[5px]"
                >
                  {label}
                  {value === "updates" && updateResult?.kind === "available" ? " •" : ""}
                </button>
            ))}
          </div>

          <form
              className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0"
              onSubmit={(e) => {
                e.preventDefault();
                void saveSettings();
              }}
          >
            <section
                id="airpimo-panel-config"
                role="tabpanel"
                aria-labelledby="airpimo-tab-config"
                hidden={settingsTab !== "config"}
                className={panelClasses("config")}
            >
              <label htmlFor="deviceName" className="mb-[5px] block text-xs font-semibold">
                投屏设备名称
              </label>
              <Input
                  id="deviceName"
                  value={draft.device_name}
                  maxLength={48}
                  onChange={(e) => setDraft((x) => ({ ...x, device_name: e.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
              />
              <p className="my-1 text-[10px] text-muted-foreground">
                修改设备名称后，重启接收服务生效。
              </p>

              <div className="flex items-center justify-between border-b border-border px-px py-2 [&_strong]:block [&_strong]:text-xs [&_strong]:font-semibold [&_small]:mt-1 [&_small]:block [&_small]:text-[10px] [&_small]:text-muted-foreground">
                <div>
                  <strong>最大请求帧率（FPS）</strong>
                  <small>默认 60，实际帧率由手机决定</small>
                </div>
                <Input
                    className="!w-[72px] basis-[72px] text-center"
                    aria-label="最大请求帧率"
                    type="number"
                    min={1}
                    max={255}
                    step={1}
                    value={draft.fps}
                    onChange={(e) => setDraft((x) => ({ ...x, fps: Number(e.target.value) }))}
                />
              </div>

              <div className="flex items-center justify-between border-b border-border px-px py-2 [&_strong]:block [&_strong]:text-xs [&_strong]:font-semibold [&_small]:mt-1 [&_small]:block [&_small]:text-[10px] [&_small]:text-muted-foreground items-center gap-2.5">
                <div className="min-w-0">
                  <strong>画面亮度</strong>
                  <small>重启接收服务后生效</small>
                </div>
                <div className="flex basis-[128px] items-center gap-1.5 [&_input]:w-[90px] [&_input]:min-w-0 [&_input]:cursor-pointer [&_input]:accent-primary [&_output]:w-[33px] [&_output]:text-right [&_output]:text-[11px] [&_output]:tabular-nums">
                  <input
                      aria-label="画面亮度"
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={draft.brightness}
                      onChange={(e) =>
                          setDraft((x) => ({ ...x, brightness: Number(e.target.value) }))
                      }
                  />
                  <output aria-label="当前画面亮度">{draft.brightness}%</output>
                </div>
              </div>

              <div className="flex items-center justify-between border-b border-border px-px py-2 [&_strong]:block [&_strong]:text-xs [&_strong]:font-semibold [&_small]:mt-1 [&_small]:block [&_small]:text-[10px] [&_small]:text-muted-foreground">
                <div>
                  <strong>启动时开启接收</strong>
                  <small>启动软件时自动开启接收服务</small>
                </div>
                <Switch
                    aria-label="启动时开启接收"
                    checked={draft.auto_start}
                    onCheckedChange={(value) => setDraft((x) => ({ ...x, auto_start: value }))}
                />
              </div>

              <div className="flex items-center justify-between border-b border-border px-px py-2 [&_strong]:block [&_strong]:text-xs [&_strong]:font-semibold [&_small]:mt-1 [&_small]:block [&_small]:text-[10px] [&_small]:text-muted-foreground">
                <div>
                  <strong>关闭后驻留托盘</strong>
                  <small>开启：关闭窗口后隐藏到托盘，继续接收。关闭：退出软件。</small>
                </div>
                <Switch
                    aria-label="关闭后驻留托盘"
                    checked={draft.stay_in_tray}
                    onCheckedChange={(value) => setDraft((x) => ({ ...x, stay_in_tray: value }))}
                />
              </div>

              <div className="mt-[14px] min-w-0 border-t border-border pt-3">
                <label className="mb-[5px] block text-xs font-semibold" htmlFor="uxplayArgs">
                  UxPlay 自定义启动参数（高级）
                </label>
                <textarea
                    id="uxplayArgs"
                    className="mt-[7px] block min-h-[66px] w-full resize-y rounded-[7px] border border-border bg-background px-2.5 py-[9px] font-mono text-xs leading-normal text-foreground shadow-[inset_0_1px_2px_rgb(0_0_0_/_4%)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    rows={3}
                    value={draft.uxplay_args}
                    maxLength={2048}
                    placeholder="例如：-vol 0.7 -vsync no"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    onChange={(e) => setDraft((x) => ({ ...x, uxplay_args: e.target.value }))}
                />
                <p className="mb-[5px] mt-2 text-[11px] leading-[1.6] text-destructive" role="note">
                  非专业人员请勿修改，错误参数可能导致接收失败。保存后需重启接收服务才会生效。
                </p>
                <p className="my-1 text-[10px] text-muted-foreground">
                  优先级：上方设置 ＞ 自定义参数 ＞ 默认参数。支持换行、引号；-vol 可调整音量。
                </p>
              </div>
            </section>

            <section
                id="airpimo-panel-theme"
                role="tabpanel"
                aria-labelledby="airpimo-tab-theme"
                hidden={settingsTab !== "theme"}
                className={panelClasses("theme")}
            >
              <p className="my-2 text-[11px] leading-normal text-muted-foreground">
                选择界面主题。保存后生效。
              </p>
              <div
                  className="mt-2.5 grid grid-cols-3 gap-[3px] rounded-lg border border-border bg-muted p-[3px]"
                  role="radiogroup"
                  aria-label="主题"
              >
                {(
                    [
                      ["system", "跟随系统"],
                      ["light", "浅色"],
                      ["dark", "深色"],
                    ] as const
                ).map(([value, label]) => (
                    <label className="group relative min-w-0 cursor-pointer" key={value}>
                      <input
                          className="peer sr-only"
                          type="radio"
                          name="theme"
                          value={value}
                          checked={draft.theme === value}
                          onChange={() => setDraft((x) => ({ ...x, theme: value as ThemeChoice }))}
                      />
                      <span className="flex min-h-7 items-center justify-center rounded-[5px] text-[11px] font-medium text-muted-foreground transition-colors duration-150 peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-[0_1px_3px_rgba(0,0,0,0.08)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-primary group-hover:text-foreground">
                    {label}
                  </span>
                    </label>
                ))}
              </div>
            </section>

            <section
                id="airpimo-panel-updates"
                role="tabpanel"
                aria-labelledby="airpimo-tab-updates"
                hidden={settingsTab !== "updates"}
                className={panelClasses("updates")}
            >
              <div className="flex items-center justify-between border-b border-border px-px py-2 [&_strong]:block [&_strong]:text-xs [&_strong]:font-semibold [&_small]:mt-1 [&_small]:block [&_small]:text-[10px] [&_small]:text-muted-foreground">
                <div>
                  <strong>当前版本</strong>
                  <small>Airpimo v{brand.version}</small>
                </div>
              </div>
              <div
                  className={`my-2.5 break-words rounded-lg border border-border bg-muted px-3 py-2.5 text-xs leading-normal ${updateResult?.kind === "error" ? "text-destructive" : ""}`}
                  role="status"
                  aria-live="polite"
              >
                {updateChecking
                    ? "正在检查更新…"
                    : !updateResult
                        ? "尚未检查更新"
                        : updateResult.kind === "available"
                            ? `发现新版本 ${updateResult.latest}`
                            : updateResult.kind === "latest"
                                ? `已是最新版本（v${updateResult.current}）`
                                : updateResult.message}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => void runUpdateCheck()}
                    disabled={updateChecking}
                >
                  {updateChecking ? "检查中…" : "检查更新"}
                </Button>
                {updateResult?.kind === "available" && (
                    <Button
                        type="button"
                        onClick={() => void openRelease()}
                        disabled={releaseOpening}
                    >
                      {releaseOpening ? "打开中…" : "下载"}
                    </Button>
                )}
              </div>
            </section>

            <section
                id="airpimo-panel-diagnostics"
                role="tabpanel"
                aria-labelledby="airpimo-tab-diagnostics"
                hidden={settingsTab !== "diagnostics"}
                className={panelClasses(
                    "diagnostics",
                    "flex flex-col overflow-hidden [&_textarea]:min-h-[90px] [&_textarea]:flex-1",
                )}
            >
            <textarea
                className="h-[230px] w-full resize-none rounded-lg border border-border bg-muted p-2.5 font-mono text-[11px] leading-[1.55] text-foreground"
                value={diagnostics}
                readOnly
                aria-label="诊断日志"
            />
              <div className="mt-3 flex shrink-0 items-center justify-between gap-x-3 gap-y-2">
                <p className="m-0 min-w-0 flex-[1_1_150px] text-left text-[10px] leading-normal text-muted-foreground">
                  只记录脱敏状态与错误类别，不采集投屏画面。
                </p>
                <div className="flex justify-end gap-[7px]">
                  <Button type="button" variant="outline" onClick={() => void loadDiagnostics()}>
                    刷新
                  </Button>
                  <Button
                      type="button"
                      onClick={() => void exportDiagnostics()}
                      disabled={diagnosticsExporting}
                  >
                    {diagnosticsExporting ? "导出中…" : "导出日志"}
                  </Button>
                </div>
              </div>
              {diagnosticsExportStatus && (
                  <p
                      className={`mt-2 max-h-[44px] shrink-0 overflow-y-auto break-words text-[11px] text-muted-foreground ${diagnosticsExportStatus.startsWith("导出失败") ? "text-destructive" : ""}`}
                      role="status"
                      title={diagnosticsExportStatus}
                  >
                    {diagnosticsExportStatus}
                  </p>
              )}
            </section>

            {formError && (settingsTab === "config" || settingsTab === "theme") && (
                <div className="mt-[9px] text-[11px] text-[#cf293e]" role="alert">
                  {formError}
                </div>
            )}
            {(settingsTab === "config" || settingsTab === "theme") && (
                <div className="flex shrink-0 justify-end gap-[7px] border-t border-border bg-background px-[18px] pb-1 pt-3">
                  <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>
                    取消
                  </Button>
                  <Button type="submit" disabled={actionBusy}>
                    保存设置
                  </Button>
                </div>
            )}
          </form>
        </DialogContent>
      </Dialog>
  );
}

interface UpdateNoticeProps {
  updateNoticeOpen: boolean;
  setUpdateNoticeOpen(value: boolean): void;
  updateResult: ReleaseStatus | null;
  releaseOpenError: string;
  releaseOpening: boolean;
  openRelease(): Promise<void>;
}

export function AirpimoUpdateNotice({
                                      updateNoticeOpen,
                                      setUpdateNoticeOpen,
                                      updateResult,
                                      releaseOpenError,
                                      releaseOpening,
                                      openRelease,
                                    }: UpdateNoticeProps) {
  const { dialogMac, overlayClass } = useDialogPosition();

  return (
      <Dialog open={updateNoticeOpen} onOpenChange={setUpdateNoticeOpen}>
        <DialogContent
            className={`w-[min(390px,calc(100vw-32px))] overflow-y-auto p-5 ${dialogMac ? "top-[calc(46px+(100vh-46px)/2)] max-h-[calc(100vh-58px)] [@media(max-height:390px)]:top-[calc(42px+(100vh-42px)/2)] [@media(max-height:390px)]:max-h-[calc(100vh-46px)]" : ""}`}
            overlayClassName={overlayClass}
        >
          <DialogTitle className="text-[15px] font-[650] leading-[1.3]">
            发现新版本
          </DialogTitle>
          <DialogDescription className="mt-2.5 text-xs leading-[1.7] text-muted-foreground">
            当前版本 v{brand.version}，最新版本{" "}
            {updateResult?.kind === "available" ? updateResult.latest : ""}。
            点击「下载」将在浏览器中打开对应的 GitHub Release 下载页。
          </DialogDescription>
          {releaseOpenError && (
              <p className="mt-[9px] text-[11px] text-[#cf293e]" role="alert">
                {releaseOpenError}
              </p>
          )}
          <div className="mt-3 flex justify-end gap-[7px]">
            <Button type="button" variant="outline" onClick={() => setUpdateNoticeOpen(false)}>
              稍后
            </Button>
            <Button
                type="button"
                onClick={() => void openRelease()}
                disabled={releaseOpening || updateResult?.kind !== "available"}
            >
              {releaseOpening ? "打开中…" : "下载"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
  );
}
