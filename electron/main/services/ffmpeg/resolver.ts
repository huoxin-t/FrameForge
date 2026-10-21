/**
 * FFmpeg / FFprobe 路径解析。
 *
 * 解析顺序：
 * 1. FRAMEFORGE_FFMPEG_DIR 环境变量（便于开发、测试和用户手工指定）；
 * 2. 随包目录：
 *    - 打包模式：process.resourcesPath/ffmpeg/<platform>-<arch>
 *    - 开发模式：<appPath>/resources/ffmpeg/<platform>-<arch>
 *    - 同时兼容旧的平铺目录 resources/ffmpeg
 * 3. 系统 PATH。
 *
 * 只有同一目录下 ffmpeg 与 ffprobe 同时存在时才算一个候选，
 * 避免把版本不匹配的两个二进制拼在一起使用。
 */
import { constants } from 'node:fs';
import { access as fsAccess } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { createLogger } from '../logger';
import type { FfmpegSource } from '../../../../shared/media';
import { getBundledFfmpegDirectories } from './layout';

const logger = createLogger('ffmpeg-resolver');

export interface FfmpegPaths {
  ffmpegPath: string;
  ffprobePath: string;
  directory: string;
  source: FfmpegSource;
}

export interface ResolveFfmpegOptions {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  access?: (path: string) => Promise<boolean>;
}

interface Candidate {
  directory: string;
  source: FfmpegSource;
}

export async function resolveFfmpegPaths(
  options: ResolveFfmpegOptions,
): Promise<FfmpegPaths | null> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const canAccess = options.access ?? defaultAccess;
  const executableSuffix = platform === 'win32' ? '.exe' : '';
  const candidates = buildCandidates(options, env);

  logger.debug('Resolving FFmpeg paths', {
    packaged: options.isPackaged,
    explicitDirectory: Boolean(env.FRAMEFORGE_FFMPEG_DIR),
    bundledDirectories: getBundledFfmpegDirectories({
      isPackaged: options.isPackaged,
      resourcesPath: options.resourcesPath,
      appPath: options.appPath,
      platform,
      arch: options.arch,
    }),
    pathEntryCount: (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean).length,
  });

  for (const candidate of candidates) {
    const ffmpegPath = join(candidate.directory, `ffmpeg${executableSuffix}`);
    const ffprobePath = join(candidate.directory, `ffprobe${executableSuffix}`);
    const [hasFfmpeg, hasFfprobe] = await Promise.all([
      canAccess(ffmpegPath),
      canAccess(ffprobePath),
    ]);

    if (hasFfmpeg && hasFfprobe) {
      logger.info('Resolved FFmpeg paths', {
        source: candidate.source,
        directory: candidate.directory,
      });
      return {
        ffmpegPath,
        ffprobePath,
        directory: candidate.directory,
        source: candidate.source,
      };
    }

    if (candidate.source !== 'system') {
      logger.debug('FFmpeg candidate incomplete', {
        directory: candidate.directory,
        source: candidate.source,
        hasFfmpeg,
        hasFfprobe,
      });
    }
  }

  logger.warn('No complete FFmpeg/FFprobe pair found');
  return null;
}

function buildCandidates(
  options: ResolveFfmpegOptions,
  env: NodeJS.ProcessEnv,
): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const add = (directory: string | undefined, source: FfmpegSource) => {
    if (!directory || !directory.trim()) {
      return;
    }

    const normalized = stripQuotes(directory.trim());
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push({ directory: normalized, source });
  };

  add(env.FRAMEFORGE_FFMPEG_DIR, 'environment');

  for (const directory of getBundledFfmpegDirectories({
    isPackaged: options.isPackaged,
    resourcesPath: options.resourcesPath,
    appPath: options.appPath,
    platform: options.platform,
    arch: options.arch,
  })) {
    add(directory, 'bundled');
  }

  const pathValue = env.PATH ?? env.Path ?? '';
  for (const entry of pathValue.split(delimiter)) {
    add(entry, 'system');
  }

  return candidates;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function defaultAccess(path: string): Promise<boolean> {
  try {
    await fsAccess(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
