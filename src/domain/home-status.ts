import { formatDuration, type Issue, type Snapshot } from "./state";

export type HomeTone = "success" | "neutral" | "warning" | "error";

export interface HomeStatus {
  tone: HomeTone;
  label: string;
  details: string;
}

const errorLabels: Record<Exclude<Issue, null>, string> = {
  missing_binary: "接收引擎不可用",
  missing_runtime: "媒体组件不可用",
  port_in_use: "接收端口被占用",
  mdns: "设备发现服务异常",
  audio: "音频输出异常",
  video: "视频播放异常",
  crash: "接收引擎意外退出",
  unknown: "接收服务异常",
};

/**
 * Human-readable receiver status. A live UxPlay process is not proof that a
 * phone can discover it, and a mirror connection does not verify audio.
 * Detailed backend errors remain accessible through the footer tooltip.
 */
export function homeStatus(
  snapshot: Snapshot,
  ready: boolean,
  bootError: string,
  now: number,
): HomeStatus {
  if (!ready) {
    return {
      tone: "neutral",
      label: "正在初始化",
      details: "正在读取本机接收服务状态",
    };
  }

  if (bootError.trim()) {
    return {
      tone: "error",
      label: "无法连接本机服务",
      details: bootError.trim(),
    };
  }

  if (snapshot.stage === "error") {
    return {
      tone: "error",
      label: snapshot.issue ? errorLabels[snapshot.issue] : "接收服务异常",
      details: snapshot.detail.trim() || "请打开设置中的诊断页面查看详情",
    };
  }

  // Avoid claiming there is an active connection from a stale or inconsistent
  // stage if the receiver process is no longer present.
  if (
    !snapshot.process_running &&
    ["waiting", "connecting", "connected"].includes(snapshot.stage)
  ) {
    return {
      tone: "neutral",
      label: "接收已停止",
      details: "接收进程未运行，请重新启动接收",
    };
  }

  if (snapshot.stage === "connected") {
    const duration = formatDuration(snapshot.connected_since, now);
    return {
      tone: "success",
      label: duration ? `正在投屏 · ${duration}` : "正在投屏",
      details: snapshot.audio_verified
        ? "镜像连接已建立，音频状态已验证"
        : "镜像连接已建立，音频输出尚未单独验证",
    };
  }

  if (snapshot.stage === "connecting") {
    return {
      tone: "neutral",
      label: "正在连接设备",
      details: "检测到设备连接请求，正在建立投屏连接",
    };
  }

  if (snapshot.stage === "starting") {
    return {
      tone: "neutral",
      label: "正在启动接收",
      details: "正在启动 AirPlay 接收服务",
    };
  }

  if (snapshot.process_running) {
    const details = snapshot.discovery_verified
      ? "AirPlay 广播已验证，可从手机的「屏幕镜像」发起连接"
      : "接收进程正在运行，可从手机的「屏幕镜像」尝试连接；设备发现尚未验证";

    return {
      tone: "neutral",
      label: "等待设备连接",
      details: snapshot.detail.includes("本次连接未完成")
        ? `上次连接未完成，可重新发起投屏。${details}`
        : snapshot.detail.includes("投屏已断开")
          ? `上次投屏已断开。${details}`
          : details,
    };
  }

  return {
    tone: "neutral",
    label: "接收已停止",
    details: "点击「开始接收」，再从手机的「屏幕镜像」选择设备",
  };
}
