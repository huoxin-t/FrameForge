import type { AppInfo } from '../../../shared/ipc';

export interface RuntimeVersions {
  electron?: string;
  chrome?: string;
  node: string;
}

export interface AppInfoSource {
  version: string;
  versions: RuntimeVersions;
  platform: string;
  arch: string;
}

export function buildAppInfo(source: AppInfoSource): AppInfo {
  return {
    name: 'FrameForge',
    version: source.version,
    electronVersion: source.versions.electron ?? '未知',
    chromeVersion: source.versions.chrome ?? '未知',
    nodeVersion: source.versions.node,
    platform: source.platform,
    arch: source.arch,
  };
}
