export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try { await navigator.clipboard.writeText(value); return; } catch { /* legacy fallback */ }
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed'; input.style.top = '-9999px';
  document.body.appendChild(input); input.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(input);
  if (!ok) throw new Error('复制失败，请手动复制设备名称');
}
