export type Stage = 'stopped' | 'starting' | 'waiting' | 'connecting' | 'connected' | 'error';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type Issue = 'missing_binary' | 'missing_runtime' | 'port_in_use' | 'mdns' | 'audio' | 'video' | 'crash' | 'unknown' | null;
export interface Settings { device_name: string; auto_start: boolean; stay_in_tray: boolean; theme: ThemeChoice; fps: number; brightness: number; uxplay_args: string; }
export interface Snapshot {
  stage: Stage;
  detail: string;
  issue: Issue;
  device_name: string;
  applied_device_name: string | null;
  applied_fps: number | null;
  applied_brightness: number | null;
  applied_uxplay_args: string | null;
  process_running: boolean;
  discovery_verified: boolean;
  audio_verified: boolean;
  connected_since: number | null;
  restart_attempts: number;
  settings: Settings;
}
export const defaultSettings: Settings = {device_name: 'Airpimo', auto_start:true, stay_in_tray:true, theme:'system', fps:60, brightness:80, uxplay_args:''};
export const defaultSnapshot: Snapshot = {stage:'stopped', detail:'接收服务尚未启动', issue:null, device_name:'Airpimo', applied_device_name:null, applied_fps:null, applied_brightness:null, applied_uxplay_args:null, process_running:false, discovery_verified:false, audio_verified:false, connected_since:null, restart_attempts:0, settings:defaultSettings};
export const stageTitle: Record<Stage, string> = {
  stopped:'接收已停止', starting:'正在启动', waiting:'等待连接', connecting:'正在连接', connected:'已连接', error:'接收出现问题'
};
export function secondaryText(s: Snapshot): string {
  if (s.stage === 'waiting' && !s.discovery_verified) return '接收进程运行中 · 网络发现尚未验证';
  if (s.stage === 'connected' && !s.audio_verified) return '镜像连接已建立 · 请确认声音正常';
  if (s.stage === 'waiting' && s.discovery_verified) return 'AirPlay 广播已核验';
  return s.detail;
}
export function issueHint(issue: Issue, development = false): string {
  switch(issue) {
    case 'missing_binary': return development ? '开发模式：运行 npm run native:doctor，或用 --uxplay 指定本机已有的 UxPlay。' : '安装包缺少内置 UxPlay，请安装包含原生引擎的完整版本。';
    case 'missing_runtime': return development ? '检查本机 GStreamer 安装及 UxPlay 的动态库依赖。' : 'GStreamer 必需插件加载失败；可能存在运行时依赖或系统兼容问题，请查看诊断信息。';
    case 'port_in_use': return '接收端口被占用，请关闭其他投屏接收软件。';
    case 'mdns': return 'Bonjour/mDNS 服务异常，请检查本机网络和防火墙。';
    case 'audio': return '音频输出异常，请检查声卡、音量与 GStreamer 插件。';
    case 'video': return '视频解码失败，请检查 GStreamer 插件和驱动。';
    case 'crash': return '接收引擎意外退出，可尝试重新启动。';
    case 'unknown': return '请查看诊断信息，并确认电脑与手机位于同一局域网。';
    default: return '';
  }
}
export function validateDeviceName(value: string): string | null {
  const name = value.trim();
  if (!name) return '设备名称不能为空';
  if ([...name].length > 48) return '设备名称最多 48 个字符';
  if (/[\x00-\x1f\x7f<>"\\/]/u.test(name)) return '名称包含不支持的字符';
  return null;
}
export function validateFps(value: number): string | null {
  return Number.isInteger(value) && value >= 1 && value <= 255 ? null : '最大请求帧率必须为 1–255 的整数';
}
export function validateBrightness(value: number): string | null {
  return Number.isInteger(value) && value >= 0 && value <= 100 ? null : '画面亮度必须为 0–100%';
}
export function validateUxplayArgs(value: string): string | null {
  if (new TextEncoder().encode(value).length > 2048) return 'UxPlay 参数最多 2048 字节';
  if (/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/.test(value)) return 'UxPlay 参数不能包含不支持的控制字符';
  return null;
}
export function showRestartPrompt(s: Snapshot) {
  return s.process_running && (
    (s.applied_device_name !== null && s.settings.device_name !== s.applied_device_name) ||
    (s.applied_fps !== null && s.settings.fps !== s.applied_fps) ||
    (s.applied_brightness !== null && s.settings.brightness !== s.applied_brightness) ||
    (s.applied_uxplay_args !== null && s.settings.uxplay_args !== s.applied_uxplay_args)
  );
}
export function formatDuration(seconds: number | null, now: number) {
  if (seconds === null) return '';
  const total = Math.max(0, Math.floor(now - seconds));
  return `${String(Math.floor(total/3600)).padStart(2,'0')}:${String(Math.floor(total%3600/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}
