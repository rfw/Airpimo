import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Settings, Snapshot } from '../domain/state';
export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
function requireDesktop() { if (!isDesktop()) throw new Error('请在 Tauri 桌面应用中启动（浏览器仅供 UI 预览）'); }
export const desktop = {
  async snapshot(): Promise<Snapshot> { requireDesktop(); return invoke('get_snapshot'); },
  async settings(): Promise<Settings> { requireDesktop(); return invoke('get_settings'); },
  async start(): Promise<Snapshot> { requireDesktop(); return invoke('start_receiving'); },
  async stop(): Promise<Snapshot> { requireDesktop(); return invoke('stop_receiving'); },
  async retry(): Promise<Snapshot> { requireDesktop(); return invoke('retry_receiving'); },
  async save(settings: Settings): Promise<Snapshot> { requireDesktop(); return invoke('save_settings', { settings }); },
  async diagnostics(): Promise<string> { requireDesktop(); return invoke('get_diagnostics'); },
  async exportDiagnostics(): Promise<string> { requireDesktop(); return invoke('export_diagnostics'); },
  async openReleasePage(url: string): Promise<void> { requireDesktop(); return invoke('open_release_page', { url }); },
  async watch(cb:(value: Snapshot)=>void):Promise<UnlistenFn> { requireDesktop(); return listen<Snapshot>('receiver://snapshot', event=>cb(event.payload)); }
};
