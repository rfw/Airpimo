/** Check published, stable GitHub Releases; do not download/run unsigned installers. */
declare const __AIRPIMO_RELEASE_REPO__: string;

export type ReleaseStatus =
  | { kind: 'unconfigured'; message: string }
  | { kind: 'latest'; current: string; latest: string }
  | { kind: 'available'; current: string; latest: string; pageUrl: string }
  | { kind: 'error'; message: string };

const repository = typeof __AIRPIMO_RELEASE_REPO__ === 'string' ? __AIRPIMO_RELEASE_REPO__ : '';
export const releaseRepository = /^[\w.-]+\/[\w.-]+$/.test(repository) ? repository : '';

export function compareReleaseVersion(a: string, b: string): number {
  // Strictly support stable versions. Never install a prerelease through this channel.
  const parts = (value: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9a-z.-]+)?$/i.exec(value);
    return match ? match.slice(1, 4).map(Number) : null;
  };
  const left = parts(a), right = parts(b);
  if (!left || !right) throw new Error('发布版本号不是稳定版 SemVer');
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

export async function checkForRelease(current: string): Promise<ReleaseStatus> {
  if (!releaseRepository) return { kind: 'unconfigured', message: '未配置 GitHub Release 仓库。请在构建环境设置 AIRPIMO_RELEASE_REPOSITORY=owner/repo。' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://api.github.com/repos/${releaseRepository}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 404) return {kind:'error', message:'暂未找到公开的正式 Release。私有仓库需要另行配置更新服务。'};
      if (response.status === 403) return {kind:'error', message:'GitHub API 暂时限制访问，请稍后重试。'};
      return {kind:'error', message:`更新服务请求失败（HTTP ${response.status}）。`};
    }
    const info: unknown = await response.json();
    if (!info || typeof info !== 'object' || !('tag_name' in info) || typeof info.tag_name !== 'string' ||
        !('draft' in info) || info.draft !== false || !('prerelease' in info) || info.prerelease !== false) {
      return {kind:'error', message:'GitHub Release 元数据格式不正确。'};
    }
    const latest = info.tag_name;
    if (!/^v?\d+\.\d+\.\d+$/.test(latest)) return {kind:'error', message:'发布版本号不是稳定版 SemVer。'};
    const newer = compareReleaseVersion(latest, current) > 0;
    return newer ? {
      kind: 'available', current, latest,
      pageUrl: `https://github.com/${releaseRepository}/releases/tag/${encodeURIComponent(latest)}`,
    } : { kind: 'latest', current, latest };
  } catch (error) {
    return {kind:'error', message: error instanceof Error && error.name === 'AbortError' ? '检查更新超时，请检查网络后重试。' : '无法连接 GitHub 更新服务，请检查网络或代理设置。'};
  } finally { clearTimeout(timeout); }
}

let automaticCheck: Promise<ReleaseStatus> | undefined;
export function checkAtStartup(current: string): Promise<ReleaseStatus> {
  return automaticCheck ??= checkForRelease(current);
}
