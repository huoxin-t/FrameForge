/**
 * FFmpeg 编码器能力服务。
 *
 * 首次请求时真实执行 `ffmpeg -hide_banner -encoders`，解析结果并缓存。
 * FFmpeg 不可用或命令失败时返回全 false 的能力矩阵，不把未知状态
 * 当成“编码器可用”。错误缓存不会永久生效，下一次请求会重新检测。
 */
import type { FfmpegStatus } from '../../../../shared/media';
import type { ConversionCapabilities } from '../../../../shared/capabilities';
import {
  NO_ENCODERS_AVAILABLE,
  buildConversionCapabilities,
  parseEncoderList,
} from '../../../../shared/capabilities';
import { createLogger } from '../logger';
import { runProcess, type RunProcess } from './process';

const logger = createLogger('ffmpeg-capabilities');

export interface FfmpegCapabilityServiceDependencies {
  getFfmpegStatus: () => Promise<
    Pick<FfmpegStatus, 'available' | 'ffmpegPath' | 'version' | 'error'>
  >;
  runProcess?: RunProcess;
  now?: () => number;
}

export class FfmpegCapabilityService {
  private readonly getFfmpegStatus: FfmpegCapabilityServiceDependencies['getFfmpegStatus'];
  private readonly execute: RunProcess;
  private readonly now: () => number;
  private cached: ConversionCapabilities | null = null;
  private pending: Promise<ConversionCapabilities> | null = null;

  constructor(dependencies: FfmpegCapabilityServiceDependencies) {
    this.getFfmpegStatus = dependencies.getFfmpegStatus;
    this.execute = dependencies.runProcess ?? runProcess;
    this.now = dependencies.now ?? Date.now;
  }

  getCapabilities(refresh = false): Promise<ConversionCapabilities> {
    if (this.cached && this.cached.error === null && !refresh) {
      return Promise.resolve(this.cached);
    }

    if (this.pending && !refresh) {
      return this.pending;
    }

    let task: Promise<ConversionCapabilities>;
    task = this.check().finally(() => {
      if (this.pending === task) {
        this.pending = null;
      }
    });
    this.pending = task;
    return task;
  }

  private async check(): Promise<ConversionCapabilities> {
    const status = await this.getFfmpegStatus();

    if (!status.available || !status.ffmpegPath) {
      this.cached = buildConversionCapabilities(NO_ENCODERS_AVAILABLE, {
        checkedAt: this.now(),
        ffmpegVersion: status.version,
        error: status.error ?? 'FFmpeg 未就绪，无法检测编码器',
      });
      logger.warn('FFmpeg capabilities unavailable', {
        error: this.cached.error,
      });
      return this.cached;
    }

    try {
      const result = await this.execute({
        executable: status.ffmpegPath,
        args: ['-hide_banner', '-encoders'],
        timeoutMs: 10_000,
      });
      const encoders = parseEncoderList(`${result.stdout}\n${result.stderr}`);
      this.cached = buildConversionCapabilities(encoders, {
        checkedAt: this.now(),
        ffmpegVersion: status.version,
        error: null,
      });
      logger.info('FFmpeg capabilities detected', {
        ffmpegVersion: status.version,
        encoders,
        availableFormats: this.cached.formats
          .filter((format) => format.available)
          .map((format) => format.format),
      });
      return this.cached;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '无法读取 FFmpeg 编码器列表';
      this.cached = buildConversionCapabilities(NO_ENCODERS_AVAILABLE, {
        checkedAt: this.now(),
        ffmpegVersion: status.version,
        error: `无法读取 FFmpeg 编码器列表：${message}`,
      });
      logger.error('FFmpeg capability detection failed', { error });
      return this.cached;
    }
  }
}
