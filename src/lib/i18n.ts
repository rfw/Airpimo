/** Front-end display preferences only: never send this value to the receiver backend. */
export type LanguageChoice = 'system' | 'zh-CN' | 'en';
export type Language = Exclude<LanguageChoice, 'system'>;
export const LANGUAGE_STORAGE_KEY = 'airpimo.language';

export function parseLanguageChoice(value: unknown): LanguageChoice {
  return value === 'zh-CN' || value === 'en' ? value : 'system';
}

export function systemLanguage(languages: readonly string[] = []): Language {
  // A Chinese OS locale (including zh-HK / zh-TW) uses the only supported Chinese UI.
  const preferred = languages.find(value => typeof value === 'string' && value.trim());
  return preferred && /^zh(?:-|$)/i.test(preferred) ? 'zh-CN' : 'en';
}

export function resolveLanguage(choice: LanguageChoice, system: Language): Language {
  return choice === 'system' ? system : choice;
}

export function readLanguageChoice(storage: Pick<Storage, 'getItem'> | null): LanguageChoice {
  try { return parseLanguageChoice(storage?.getItem(LANGUAGE_STORAGE_KEY)); }
  catch { return 'system'; }
}

export function detectSystemLanguage(nav: Pick<Navigator, 'languages' | 'language'>): Language {
  return systemLanguage(nav.languages?.length ? nav.languages : [nav.language]);
}

// Chinese is the stable message ID: preserves existing source diagnostics and
// makes untranslated keys visible when extending the UI. No runtime dependency.
const english: Record<string, string> = {
  '设置': 'Settings', 'Airpimo · 配置与维护': 'Airpimo · Configuration & maintenance',
  '关闭设置': 'Close settings', '设置选项卡': 'Settings tabs',
  '配置': 'General', '主题': 'Theme', '界面': 'Interface', '升级': 'Updates', '关于': 'About', '诊断': 'Diagnostics',
  '投屏设备名称': 'Receiver name', '修改设备名称后，重启接收服务生效。': 'Restart the receiver to apply a new device name.',
  '最大请求帧率（FPS）': 'Maximum requested FPS', '最大请求帧率': 'Maximum FPS',
  '默认 60，实际帧率由手机决定': 'Default 60; the phone determines the actual frame rate',
  '画面亮度': 'Image brightness', '当前画面亮度': 'Current brightness',
  '重启接收服务后生效': 'Applies after restarting the receiver',
  '启动时开启接收': 'Start receiving on launch', '启动软件时自动开启接收服务': 'Automatically start the receiver when the app opens',
  '关闭后驻留托盘': 'Keep running in tray on close', '开启：关闭窗口后隐藏到托盘。关闭：退出软件。': 'On: hide to tray when closed. Off: quit the app.',
  '高级功能': 'Advanced options', 'UxPlay 自定义启动参数（高级）': 'Custom UxPlay launch arguments (advanced)',
  '例如：-vol 0.7 -vsync no': 'Example: -vol 0.7 -vsync no',
  '非专业人员请勿修改，错误参数可能导致接收失败。保存后需重启接收服务才会生效。': 'For advanced users only. Invalid arguments can prevent receiving. Restart the receiver after saving.',
  '优先级：上方设置 ＞ 自定义参数 ＞ 默认参数。支持换行、引号；-vol 可调整音量。': 'Priority: settings above > custom arguments > defaults. Quotes and line breaks are supported; -vol adjusts volume.',
  '外观主题': 'Appearance', '选择外观主题，切换后立即生效。': 'Choose a theme. Changes apply immediately.',
  '正在保存外观设置…': 'Saving appearance…', '主题保存失败': 'Failed to save appearance',
  '跟随系统': 'Follow system', '浅色': 'Light', '深色': 'Dark',
  '界面语言': 'Interface language', '选择界面语言，切换后立即生效。': 'Choose the interface language. Changes apply immediately.',
  '简体中文': '简体中文', '取消': 'Cancel', '保存设置': 'Save settings',
  '当前版本': 'Current version', '正在检查更新…': 'Checking for updates…', '尚未检查更新': 'Updates not checked yet',
  '检查中…': 'Checking…', '检查更新': 'Check for updates', '打开中…': 'Opening…', '下载': 'Download',
  '软件更新': 'Software updates', '检查新版本并从 GitHub Release 获取安装包。': 'Check for a new version and get installers from GitHub Releases.',
  '项目信息': 'Project information',
  '发现新版本': 'New version available', '已是最新版本': 'You are up to date',
  'Airpimo 应用图标': 'Airpimo app icon', '版本': 'Version',
  '轻量、开源的 AirPlay 接收工具': 'Lightweight open-source AirPlay receiver',
  '支持将 iPhone / iPad 屏幕投射到电脑': 'Mirror your iPhone / iPad screen to your computer',
  '打开 GitHub 项目主页': 'Open GitHub project page', '开源协议': 'Open-source license',
  '诊断日志': 'Diagnostic log', '只记录脱敏状态与错误类别，不采集投屏画面。': 'Only sanitized states and error categories are logged. Screen content is never captured.',
  '刷新': 'Refresh', '导出中…': 'Exporting…', '导出日志': 'Export log',
  '诊断读取失败': 'Failed to load diagnostics', '导出失败': 'Export failed',
  '读取中…': 'Loading…', '正在导出…': 'Exporting…', '已导出到': 'Exported to',
  '诊断日志已导出': 'Diagnostic log exported',
  '当前版本 v{current}，最新版本 {latest}。': 'Current version v{current}, latest version {latest}.',
  '发现新版本：': 'New version:', '当前版本 v': 'Current version v', '最新版本': 'latest version',
  '点击「下载」将在浏览器中打开对应的 GitHub Release 下载页。': 'Select Download to open the GitHub Release page in your browser.',
  '稍后': 'Later', '打开下载页面失败': 'Failed to open download page',
  '复制投屏设备名称': 'Copy receiver name', '复制设备名称': 'Copy name',
  '停止接收': 'Stop receiving', '开始接收': 'Start receiving',
  '设置已修改 · 点击重启生效': 'Settings changed · Click to restart', '复制成功': 'Copied',
  '点击关闭消息': 'Click to dismiss', '打开设置': 'Open settings', '设置 · 发现新版本': 'Settings · New version available',
  'Airpimo 投屏接收': 'Airpimo screen receiver', 'iPhone 控制中心': 'iPhone Control Center', '屏幕镜像': 'Screen Mirroring',
  '当前是浏览器 UI 预览，尚未连接到本机 AirPlay 引擎。': 'Browser UI preview: not connected to the local AirPlay receiver.',
  '打开 GitHub 失败': 'Failed to open GitHub',
  '正在初始化': 'Initializing', '正在读取本机接收服务状态': 'Reading local receiver status',
  '无法连接本机服务': 'Cannot connect to local service', '接收服务异常': 'Receiver error',
  '接收进程未运行，请重新启动接收': 'Receiver process is not running. Restart receiving.',
  '正在投屏': 'Mirroring', '镜像连接已建立，音频状态已验证': 'Mirror connected; audio status verified',
  '镜像连接已建立，音频输出尚未单独验证': 'Mirror connected; audio output not yet verified',
  '正在连接设备': 'Connecting to device', '检测到设备连接请求，正在建立投屏连接': 'Device connection request detected; establishing mirror session',
  '正在启动接收': 'Starting receiver', '正在启动 AirPlay 接收服务': 'Starting the AirPlay receiver',
  '等待设备连接': 'Waiting for device',
  'AirPlay 广播已验证，可从手机的「屏幕镜像」发起连接': 'AirPlay advertisement verified. Connect using Screen Mirroring on your phone.',
  '接收进程正在运行，可从手机的「屏幕镜像」尝试连接；设备发现尚未验证': 'Receiver is running. Try Screen Mirroring on your phone; discovery has not been verified.',
  '上次连接未完成，可重新发起投屏。': 'Previous connection did not finish. Try mirroring again. ',
  '上次投屏已断开。': 'Previous mirror session disconnected. ',
  '接收已停止': 'Receiver stopped', '点击「开始接收」，再从手机的「屏幕镜像」选择设备': 'Select Start receiving, then choose this device from Screen Mirroring on your phone.',
  '接收引擎不可用': 'Receiver engine unavailable', '媒体组件不可用': 'Media component unavailable',
  '接收端口被占用': 'Receiver port in use', '设备发现服务异常': 'Device discovery unavailable',
  '音频输出异常': 'Audio output error', '视频播放异常': 'Video playback error',
  '接收引擎意外退出': 'Receiver engine exited unexpectedly',
  '请打开设置中的诊断页面查看详情': 'Open Settings > Diagnostics for details',
  '开发模式：运行 npm run native:doctor，或用 --uxplay 指定本机已有的 UxPlay。': 'Development: run npm run native:doctor or specify an existing UxPlay with --uxplay.',
  '安装包缺少内置 UxPlay，请安装包含原生引擎的完整版本。': 'Bundled UxPlay is missing. Install the full release with the native engine.',
  '检查本机 GStreamer 安装及 UxPlay 的动态库依赖。': 'Check GStreamer installation and UxPlay library dependencies.',
  'GStreamer 必需插件加载失败；可能存在运行时依赖或系统兼容问题，请查看诊断信息。': 'Required GStreamer plugins failed to load. Check runtime dependencies, OS compatibility and diagnostics.',
  '接收端口被占用，请关闭其他投屏接收软件。': 'Receiver port is in use. Close other mirroring receivers.',
  'Bonjour/mDNS 服务异常，请检查本机网络和防火墙。': 'Bonjour/mDNS service error. Check network and firewall.',
  '音频输出异常，请检查声卡、音量与 GStreamer 插件。': 'Audio output error. Check the audio device, volume and GStreamer plugins.',
  '视频解码失败，请检查 GStreamer 插件和驱动。': 'Video decoding failed. Check GStreamer plugins and drivers.',
  '接收引擎意外退出，可尝试重新启动。': 'Receiver engine exited unexpectedly. Try restarting.',
  '请查看诊断信息，并确认电脑与手机位于同一局域网。': 'Check diagnostics and ensure your computer and phone share the same local network.',
  '设备名称不能为空': 'Device name cannot be empty', '设备名称最多 48 个字符': 'Device name may contain at most 48 characters',
  '名称包含不支持的字符': 'Device name contains unsupported characters', '设备名称包含不支持的字符': 'Device name contains unsupported characters',
  '最大请求帧率必须为 1–255 的整数': 'Maximum requested FPS must be an integer from 1 to 255',
  '请求帧率必须为 1–255 的整数': 'Requested FPS must be an integer from 1 to 255',
  '画面亮度必须为 0–100%': 'Image brightness must be 0–100%',
  'UxPlay 参数最多 2048 字节': 'UxPlay arguments may contain at most 2048 bytes',
  'UxPlay 参数不能包含不支持的控制字符': 'UxPlay arguments contain unsupported control characters',
  '接收服务尚未启动': 'Receiver has not started', '接收服务已停止': 'Receiver stopped',
  '正在启动 UxPlay…': 'Starting UxPlay…', '本次连接未完成，继续等待手机投屏': 'Connection did not finish; waiting for phone',
  '接收进程运行中；尚未验证 mDNS 广播': 'Receiver running; mDNS advertisement not yet verified',
  '已发现连接尝试，镜像尚未建立': 'Connection attempt detected; mirror not established',
  '镜像画面连接已建立（声音待实测）': 'Mirror connected (audio not yet verified)',
  '投屏已断开，接收进程仍运行': 'Mirror disconnected; receiver still running',
  '接收端口已被占用': 'Receiver port is already in use',
  '安装包缺少内置 UxPlay 引擎，请重新安装经完整原生打包检查的版本': 'Bundled UxPlay engine is missing. Reinstall a fully verified native build.',
  '安装包缺少独立 GStreamer 运行时或插件；请使用完整打包的发行版本': 'Bundled GStreamer runtime or plugins are missing. Install the full release.',
  '开发模式的 GStreamer 根目录缺少 bin 或 lib/gstreamer-1.0': 'Development GStreamer directory is missing bin or lib/gstreamer-1.0',
  '开发模式未找到 UxPlay。请执行 npm run native:doctor，或使用 npm run desktop:dev -- --uxplay /绝对路径/UxPlay/build/uxplay': 'UxPlay not found in development. Run npm run native:doctor or specify its absolute path with --uxplay.',
  '开发模式指定的 UxPlay 路径无效；请使用绝对路径和可执行文件': 'Invalid development UxPlay path. Use an absolute path to an executable.',
  '安装包缺少 macOS 播放窗口标题原生扩展，请重新生成完整版安装包': 'macOS player window title extension is missing. Rebuild the complete release.',
  '仅允许 GitHub Release 下载页': 'Only GitHub Release pages are allowed',
  '更新链接必须是官方仓库的稳定版 GitHub Release': 'Update link must point to a stable GitHub Release of the official repository',
  '系统时间异常': 'System clock error', '无法定位下载目录': 'Cannot find Downloads folder',
  '导出诊断日志失败': 'Failed to export diagnostics',
  '无法打开系统浏览器': 'Cannot open system browser',
  '配置路径无效': 'Invalid settings path', '创建配置目录失败': 'Cannot create settings directory',
  '创建配置临时文件失败': 'Cannot create temporary settings file', '写入配置失败': 'Cannot write settings',
  '原子替换配置失败': 'Cannot replace settings file',
  'UxPlay 自定义参数最多 2048 字节': 'Custom UxPlay arguments may contain at most 2048 bytes',
  'UxPlay 自定义参数不能包含不支持的控制字符': 'Custom UxPlay arguments contain unsupported control characters',
  'UxPlay 自定义参数最多 64 项': 'At most 64 custom UxPlay arguments are supported',
  'UxPlay 自定义参数引号未闭合': 'Unclosed quote in UxPlay arguments',
  '单个 UxPlay 参数不得超过 512 字节': 'A single UxPlay argument may not exceed 512 bytes',
  'UxPlay 参数不能包含空字符串': 'UxPlay arguments must not contain empty strings',

  'GStreamer 必需解码插件无法加载；检查原生运行时兼容性': 'Required GStreamer decoder plugin failed to load; check native runtime compatibility',
  'DNS-SD 动态库加载失败；此引擎仍需要 Bonjour，请使用经验证的内置 mDNS 版本': 'DNS-SD library failed to load; Bonjour is required for this engine. Use the validated bundled mDNS build.',
  'Bonjour/mDNS 服务未找到或未运行': 'Bonjour/mDNS service not found or not running',
  'GStreamer 插件或动态库缺失': 'Missing GStreamer plugin or library', 'Bonjour/mDNS 服务异常': 'Bonjour/mDNS service error',
  '音频输出设备初始化失败': 'Audio output device initialization failed', '视频解码或渲染异常': 'Video decoding or rendering error',
  'UxPlay 启动失败（0xC0000135）：缺少 DLL 或 DLL 依赖版本不兼容，请检查 GStreamer Runtime 与诊断信息': 'UxPlay startup failed (0xC0000135): missing/incompatible DLL dependency. Check GStreamer Runtime and diagnostics.',
  '未配置 GitHub Release 仓库。请在构建环境设置 AIRPIMO_RELEASE_REPOSITORY=owner/repo。': 'GitHub Release repository not configured. Set AIRPIMO_RELEASE_REPOSITORY=owner/repo at build time.',
  '暂未找到公开的正式 Release。私有仓库需要另行配置更新服务。': 'No public stable Release found. Private repositories require a separate update service.',
  'GitHub API 暂时限制访问，请稍后重试。': 'GitHub API rate limit reached. Try again later.',
  'GitHub Release 元数据格式不正确。': 'Invalid GitHub Release metadata.',
  '发布版本号不是稳定版 SemVer。': 'Release version is not stable SemVer.',
  '检查更新超时，请检查网络后重试。': 'Update check timed out. Check your network and retry.',
  '无法连接 GitHub 更新服务，请检查网络或代理设置。': 'Cannot connect to the GitHub update service. Check network or proxy settings.',
};

/** Translate display text only. Leave unexpected technical diagnostics intact. */
export function translate(text: string, language: Language): string {
  if (language === 'zh-CN') return text;
  if (Object.prototype.hasOwnProperty.call(english, text)) return english[text];
  const http = /^更新服务请求失败（HTTP (\d+)）。$/.exec(text);
  if (http) return `Update service request failed (HTTP ${http[1]}).`;
  const exited = /^UxPlay 意外退出（退出码 (.+)）$/.exec(text);
  if (exited) return `UxPlay exited unexpectedly (exit code ${exited[1]})`;
  const launch = /^UxPlay 无法启动：(.+)$/.exec(text);
  if (launch) return `Unable to launch UxPlay: ${translate(launch[1], language)}`;
  const job = /^Windows 无法托管 UxPlay 进程树：(.+)$/.exec(text);
  if (job) return `Unable to manage UxPlay process tree on Windows: ${job[1]}`;
  const prefixed = /^(.+?)(：|: )(.+)$/.exec(text);
  if (prefixed && Object.prototype.hasOwnProperty.call(english, prefixed[1])) {
    return `${english[prefixed[1]]}: ${prefixed[3]}`;
  }
  return text;
}

export function translateTemplate(text: string, language: Language, values: Record<string, string | number> = {}): string {
  return translate(text, language).replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
