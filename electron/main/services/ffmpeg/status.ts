/**
 * FFmpeg 环境状态服务。
 *
 * 负责：
 * - 调用路径解析器找到 ffmpeg/ffprobe；
 * - 实际执行 `-version` 验证二进制可运行；
 * - 解析版本、缓存结果，并支持设置页/重试时强制刷新。
 */
import type { FfmpegStatus } from '../../../../shared/media';
import { createLogger } from '../logger';
import { runProcess, type RunProcess } from './process';
import type { FfmpegPaths } from './resolver';

const logger = createLogger('ffmpeg-status');

export interface FfmpegServiceDependencies {
  resolvePaths: () => Promise<FfmpegPaths | null>;
  runProcess?: RunProcess;
}

export class FfmpegService {
  private readonly resolvePaths: () => Promise<FfmpegPaths | null>;
  private readonly execute: RunProcess;
  private cached: FfmpegStatus | null = null;
  private pending: Promise<FfmpegStatus> | null = null;

  constructor(dependencies: FfmpegServiceDependencies) {
    this.resolvePaths = dependencies.resolvePaths;
    this.execute = dependencies.runProcess ?? runProcess;
  }

  getStatus(refresh = false): Promise<FfmpegStatus> {
    if (this.cached && !refresh) {
      return Promise.resolve(this.cached);
    }

    // 启动预热和 renderer 首次请求可能同时发生，共享同一次真实检测，
    // 避免重复启动两对 ffmpeg/ffprobe 进程。
    if (this.pending && !refresh) {
      return this.pending;
    }

    let task: Promise<FfmpegStatus>;
    task = this.check(refresh).finally(() => {
      if (this.pending === task) {
        this.pending = null;
      }
    });
    this.pending = task;
    return task;
  }

  private async check(refresh: boolean): Promise<FfmpegStatus> {
    logger.info('Checking FFmpeg environment', { refresh });

    try {
      const paths = await this.resolvePaths();
      if (!paths) {
        this.cached = {
          available: false,
          ffmpegPath: null,
          ffprobePath: null,
          version: null,
          ffprobeVersion: null,
          source: null,
          error:
            '未找到内置 FFmpeg。FrameForge 应随包提供 ffmpeg 与 ffprobe；请重新安装应用，或打开日志目录查看详情。',
        };
        logger.warn('FFmpeg environment unavailable', { error: this.cached.error });
        return this.cached;
      }

      const [ffmpegVersionResult, ffprobeVersionResult] = await Promise.all([
        this.execute({
          executable: paths.ffmpegPath,
          args: ['-version'],
          timeoutMs: 10000,
        }),
        this.execute({
          executable: paths.ffprobePath,
          args: ['-version'],
          timeoutMs: 10000,
        }),
      ]);

      const version = parseFfmpegVersion(ffmpegVersionResult.stdout);
      const ffprobeVersion = parseFfmpegVersion(ffprobeVersionResult.stdout);

      if (!version || !ffprobeVersion) {
        throw new Error('无法解析 FFmpeg/FFprobe 版本输出');
      }

      this.cached = {
        available: true,
        ffmpegPath: paths.ffmpegPath,
        ffprobePath: paths.ffprobePath,
        version,
        ffprobeVersion,
        source: paths.source,
        error: null,
      };

      logger.info('FFmpeg environment ready', {
        version,
        ffprobeVersion,
        source: paths.source,
        directory: paths.directory,
      });
      return this.cached;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FFmpeg 环境检查失败';
      this.cached = {
        available: false,
        ffmpegPath: null,
        ffprobePath: null,
        version: null,
        ffprobeVersion: null,
        source: null,
        error: `FFmpeg 环境检查失败：${message}`,
      };
      logger.error('FFmpeg environment check failed', { error });
      return this.cached;
    }
  }
}

export function parseFfmpegVersion(output: string): string | null {
  const match = output.match(/(?:ffmpeg|ffprobe) version\s+([^\s]+)/i);
  if (!match) {
    return null;
  }

  const fullVersion = match[1];
  const numericVersion = fullVersion.match(/^\d+(?:\.\d+){1,3}/);
  return numericVersion?.[0] ?? fullVersion;
}
