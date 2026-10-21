/**
 * FFmpeg 随包资源目录布局。
 *
 * 目标布局：
 *   resources/ffmpeg/<platform>-<arch>/ffmpeg(.exe)
 *   resources/ffmpeg/<platform>-<arch>/ffprobe(.exe)
 *
 * 同时保留旧的 resources/ffmpeg/ 平铺布局，避免已有开发目录和旧打包产物失效。
 */
import { join } from 'node:path';

export interface FfmpegLayoutOptions {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

/** 返回类似 win32-x64、darwin-arm64 的资源子目录名。 */
export function getPlatformArchDirectoryName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

/**
 * 按优先级返回随包目录候选。
 *
 * 每个根目录先查 <platform>-<arch>，再查平铺目录；这样新布局优先，
 * 旧布局仍然可用。返回值已去重，避免打包模式下同一路径被检查两次。
 */
export function getBundledFfmpegDirectories(
  options: FfmpegLayoutOptions,
): string[] {
  const roots: string[] = [];
  const platformDirectory = getPlatformArchDirectoryName(
    options.platform,
    options.arch,
  );

  if (options.isPackaged && options.resourcesPath) {
    roots.push(join(options.resourcesPath, 'ffmpeg'));
  }

  if (!options.isPackaged && options.appPath) {
    roots.push(join(options.appPath, 'resources', 'ffmpeg'));
  }

  // 开发模式和免安装目录测试都可能显式提供 resourcesPath。
  if (options.resourcesPath) {
    roots.push(join(options.resourcesPath, 'ffmpeg'));
  }

  const directories: string[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    for (const candidate of [join(root, platformDirectory), root]) {
      const key = candidate.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      directories.push(candidate);
    }
  }

  return directories;
}
