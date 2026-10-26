/** Development-only native test harness. Do not import from production entry points. */
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './desktop';
import type { Snapshot } from '../domain/state';

function requireDev() {
  if (!import.meta.env.DEV || !isDesktop()) {
    throw new Error('模拟投屏仅在 Tauri 开发模式中可用');
  }
}
export async function start(): Promise<Snapshot> {
  requireDev();
  return invoke('start_simulated_mirroring');
}
export async function stop(): Promise<Snapshot> {
  requireDev();
  return invoke('stop_simulated_mirroring');
}
