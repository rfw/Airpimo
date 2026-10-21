import {formatDuration, secondaryText, stageTitle, type Snapshot} from './state';

export type HomeTone = 'success' | 'neutral' | 'warning' | 'error';
export interface HomeStatus {tone: HomeTone; label: string; details: string}

/** A single, truthful status source for the footer (never assert discovery before verification). */
export function homeStatus(snapshot: Snapshot, ready: boolean, bootError: string, now: number): HomeStatus {
  if (!ready) return {tone:'neutral', label:'正在初始化', details:'正在读取本机接收状态'};
  if (bootError) return {tone:'error', label:`桌面服务错误：${bootError}`, details:bootError};
  const details = `${stageTitle[snapshot.stage]} · ${secondaryText(snapshot)}`;
  if (snapshot.stage === 'error') return {tone:'error', label:snapshot.detail ? `接收异常：${snapshot.detail}` : '接收服务出现问题', details};
  if (snapshot.stage === 'connected') {
    const duration = formatDuration(snapshot.connected_since, now);
    return {tone:'success', label:duration ? `正在投屏 · ${duration}` : '正在投屏', details};
  }
  if (snapshot.stage === 'connecting') return {tone:'warning', label:'正在建立连接', details};
  if (snapshot.stage === 'starting') return {tone:'warning', label:'正在启动接收', details};
  if (snapshot.process_running && snapshot.discovery_verified) return {tone:'success', label:'投屏服务已就绪', details};
  if (snapshot.process_running) return {tone:'warning', label:'接收已启动 · 发现未验证', details};
  return {tone:'neutral', label:'接收服务未启动', details};
}
