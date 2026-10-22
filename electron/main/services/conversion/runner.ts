/**
 * 单个转换任务的真实 FFmpeg 执行器。
 *
 * 职责：
 * - 在任务真正启动时重新探测源文件，取得准确时长和是否有音轨；
 * - 先写入同目录临时文件，成功后再改名；
 * - 从 `-progress pipe:1` 解析进度；
 * - 退出码成功、临时文件非空、最终文件非空后才算成功；
 * - 失败或取消时清理临时文件，并把 stderr 摘要交给队列展示。
 */
import { rename as fsRename, rm as fsRm, stat } from 'node:fs/promises';
import type { FfmpegStatus } from '../../../../shared/media';
import {
  getOutputFormat,
  type ConversionJob,
  type ConversionSettings,
} from '../../../../shared/conversion';
import { createLogger } from '../logger';
import type { FfmpegService } from '../ffmpeg/status';
import { ProcessError, runProcess, type RunProcess } from '../ffmpeg/process';
import {
  probeMedia,
  probeOutputFile,
  type OutputProbeResult,
} from '../media/probe';
import { buildConversionArgs } from './args';
import {
  buildTemporaryOutputPath,
  pathExists as defaultPathExists,
} from './output';
import { FfmpegProgressParser } from './progress';

const logger = createLogger('conversion-runner');

export interface ConversionProbeResult {
  durationMs: number | null;
  hasAudio: boolean;
}

export interface ConversionRunnerDependencies {
  getFfmpegStatus: () => Promise<
    Pick<FfmpegStatus, 'available' | 'ffmpegPath' | 'ffprobePath' | 'error'>
  >;
  probe: (sourcePath: string) => Promise<ConversionProbeResult>;
  probeOutput?: (
    ffprobePath: string,
    outputPath: string,
  ) => Promise<OutputProbeResult>;
  runProcess?: RunProcess;
  pathExists?: (path: string) => Promise<boolean>;
  fileSize?: (path: string) => Promise<number>;
  rename?: (from: string, to: string) => Promise<void>;
  remove?: (path: string) => Promise<void>;
}

export interface RunConversionOptions {
  signal: AbortSignal;
  onProgress: (progress: number) => void;
}

export interface ConversionRunResult {
  outputPath: string;
}

export class ConversionError extends Error {
  readonly logExcerpt: string | null;

  constructor(message: string, logExcerpt: string | null = null) {
    super(message);
    this.name = 'ConversionError';
    this.logExcerpt = logExcerpt;
  }
}

export class ConversionCanceledError extends Error {
  constructor(message = '任务已取消') {
    super(message);
    this.name = 'ConversionCanceledError';
  }
}

export class ConversionRunner {
  private readonly getFfmpegStatus: ConversionRunnerDependencies['getFfmpegStatus'];
  private readonly probe: ConversionRunnerDependencies['probe'];
  private readonly probeOutput?: ConversionRunnerDependencies['probeOutput'];
  private readonly execute: RunProcess;
  private readonly exists: (path: string) => Promise<boolean>;
  private readonly fileSize: (path: string) => Promise<number>;
  private readonly rename: (from: string, to: string) => Promise<void>;
  private readonly remove: (path: string) => Promise<void>;

  constructor(dependencies: ConversionRunnerDependencies) {
    this.getFfmpegStatus = dependencies.getFfmpegStatus;
    this.probe = dependencies.probe;
    this.probeOutput = dependencies.probeOutput;
    this.execute = dependencies.runProcess ?? runProcess;
    this.exists = dependencies.pathExists ?? defaultPathExists;
    this.fileSize = dependencies.fileSize ?? defaultFileSize;
    this.rename = dependencies.rename ?? fsRename;
    this.remove = dependencies.remove ?? fsRm;
  }

  async run(
    job: ConversionJob,
    settings: ConversionSettings,
    options: RunConversionOptions,
  ): Promise<ConversionRunResult> {
    const startedAt = Date.now();
    const status = await this.getFfmpegStatus();
    if (!status.available || !status.ffmpegPath) {
      throw new ConversionError(status.error ?? 'FFmpeg 未就绪，无法转换');
    }

    let probe: ConversionProbeResult;
    try {
      probe = await this.probe(job.sourcePath);
    } catch (error) {
      throw new ConversionError(toErrorMessage(error), errorDetail(error));
    }

    const temporaryPath = buildTemporaryOutputPath(job.outputPath, job.id);
    const parser = new FfmpegProgressParser(probe.durationMs, options.onProgress);

    logger.info('Conversion started', {
      jobId: job.id,
      sourcePath: job.sourcePath,
      outputPath: job.outputPath,
      temporaryPath,
      format: settings.format,
      qualityPreset: settings.qualityPreset,
      durationMs: probe.durationMs,
      hasAudio: probe.hasAudio,
    });

    try {
      await this.execute({
        executable: status.ffmpegPath,
        args: buildConversionArgs({
          inputPath: job.sourcePath,
          outputPath: temporaryPath,
          format: settings.format,
          qualityPreset: settings.qualityPreset,
          hasAudio: probe.hasAudio,
        }),
        signal: options.signal,
        onStdout: (chunk) => parser.push(chunk),
      });

      if (options.signal.aborted) {
        throw new ConversionCanceledError();
      }

      const temporarySize = await this.fileSize(temporaryPath);
      if (temporarySize <= 0) {
        throw new ConversionError('FFmpeg 没有生成有效的输出文件');
      }

      // 队列已经预留名称，但改名之前再检查一次，绝不覆盖已存在的文件。
      if (await this.exists(job.outputPath)) {
        throw new ConversionError('输出文件已存在，已停止以避免覆盖');
      }

      await this.rename(temporaryPath, job.outputPath);

      const finalSize = await this.fileSize(job.outputPath);
      if (finalSize <= 0) {
        await this.remove(job.outputPath).catch(() => undefined);
        throw new ConversionError('输出文件为空，任务未完成');
      }

      await this.verifyOutput(job, settings, probe.hasAudio, status.ffprobePath);

      logger.info('Conversion completed', {
        jobId: job.id,
        outputPath: job.outputPath,
        bytes: finalSize,
        elapsedMs: Date.now() - startedAt,
      });

      return { outputPath: job.outputPath };
    } catch (error) {
      if (
        options.signal.aborted ||
        error instanceof ConversionCanceledError ||
        (error instanceof ProcessError && error.code === 'ABORTED')
      ) {
        logger.info('Conversion canceled', {
          jobId: job.id,
          elapsedMs: Date.now() - startedAt,
        });
        throw new ConversionCanceledError();
      }

      if (error instanceof ConversionError) {
        logger.warn('Conversion failed', {
          jobId: job.id,
          error: error.message,
          logExcerpt: error.logExcerpt,
          elapsedMs: Date.now() - startedAt,
        });
        throw error;
      }

      const detail = errorDetail(error);
      const message = `转换失败：${cleanDetail(detail) || 'FFmpeg 执行失败'}`;
      logger.warn('Conversion failed', {
        jobId: job.id,
        error: message,
        logExcerpt: detail,
        elapsedMs: Date.now() - startedAt,
      });
      throw new ConversionError(message, detail);
    } finally {
      await this.remove(temporaryPath).catch((error: unknown) => {
        logger.debug('Failed to remove temporary conversion file', {
          temporaryPath,
          error,
        });
      });
    }
  }

  private async verifyOutput(
    job: ConversionJob,
    settings: ConversionSettings,
    sourceHasAudio: boolean,
    ffprobePath: string | null,
  ): Promise<void> {
    if (!this.probeOutput) {
      return;
    }

    if (!ffprobePath) {
      await this.remove(job.outputPath).catch(() => undefined);
      throw new ConversionError('FFprobe 未就绪，无法验证输出文件');
    }

    try {
      const summary = await this.probeOutput(ffprobePath, job.outputPath);
      assertOutputMatchesProfile(summary, settings, sourceHasAudio);
      logger.info('Conversion output verified', {
        jobId: job.id,
        containerFormat: summary.containerFormat,
        videoCodec: summary.videoCodec,
        audioCodec: summary.audioCodec,
        hasVideo: summary.hasVideo,
        hasAudio: summary.hasAudio,
      });
    } catch (error) {
      await this.remove(job.outputPath).catch((removeError: unknown) => {
        logger.warn('Failed to remove invalid output file', {
          jobId: job.id,
          outputPath: job.outputPath,
          error: removeError,
        });
      });

      if (error instanceof ConversionError) {
        throw error;
      }

      throw new ConversionError(
        `输出校验失败：${toErrorMessage(error)}`,
        errorDetail(error),
      );
    }
  }
}

/**
 * 校验真实输出与所选 profile 一致。
 *
 * 不能只看“文件非空”：编码器异常、错误容器或 MP3 意外带视频轨，
 * 都必须让任务失败并清理输出，不能对用户显示“已完成”。
 */
export function assertOutputMatchesProfile(
  summary: OutputProbeResult,
  settings: ConversionSettings,
  sourceHasAudio: boolean,
): void {
  const profile = getOutputFormat(settings.format);

  if (summary.durationMs !== null && summary.durationMs <= 0) {
    throw new ConversionError('输出文件时长为 0，无法播放');
  }

  if (!summary.containerFormat) {
    throw new ConversionError('无法识别输出容器');
  }
  if (summary.containerFormat !== profile.probeContainer) {
    throw new ConversionError(
      `输出容器为 ${summary.containerFormat}，预期 ${profile.probeContainer}`,
    );
  }

  if (profile.kind === 'audio') {
    if (!summary.hasAudio) {
      throw new ConversionError('输出文件缺少音频轨道');
    }
    if (summary.hasVideo) {
      throw new ConversionError('仅音频输出中出现了视频轨道');
    }
    if (summary.audioCodec !== profile.audioCodec) {
      throw new ConversionError(
        `输出音频编码为 ${summary.audioCodec ?? '未知'}，预期 ${profile.audioCodec}`,
      );
    }
    return;
  }

  if (!summary.hasVideo) {
    throw new ConversionError('输出文件缺少视频轨道');
  }
  if (summary.videoCodec !== profile.videoCodec) {
    throw new ConversionError(
      `输出视频编码为 ${summary.videoCodec ?? '未知'}，预期 ${profile.videoCodec}`,
    );
  }

  if (sourceHasAudio) {
    if (!summary.hasAudio) {
      throw new ConversionError('输出文件缺少源视频中的音频轨道');
    }
    if (summary.audioCodec !== profile.audioCodec) {
      throw new ConversionError(
        `输出音频编码为 ${summary.audioCodec ?? '未知'}，预期 ${profile.audioCodec}`,
      );
    }
  } else if (summary.hasAudio) {
    throw new ConversionError('无音轨源文件却生成了音频轨道');
  }
}

/** 使用真实 FFmpeg 状态和 ffprobe 构造执行器。 */
export function createConversionRunner(
  ffmpeg: Pick<FfmpegService, 'getStatus'>,
): ConversionRunner {
  return new ConversionRunner({
    getFfmpegStatus: () => ffmpeg.getStatus(),
    probeOutput: (ffprobePath, outputPath) =>
      probeOutputFile(ffprobePath, outputPath),
    probe: async (sourcePath) => {
      const status = await ffmpeg.getStatus();
      if (!status.available || !status.ffprobePath) {
        throw new ConversionError(status.error ?? 'FFmpeg 未就绪，无法读取源文件');
      }

      const metadata = await probeMedia(status.ffprobePath, sourcePath);
      return {
        durationMs: metadata.durationMs,
        hasAudio: metadata.hasAudio,
      };
    },
  });
}

async function defaultFileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof ProcessError) {
    return error.stderr || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : '';
}

function cleanDetail(detail: string): string {
  const cleaned = detail.replace(/\s+/g, ' ').trim();
  return cleaned.length > 500 ? `${cleaned.slice(0, 500)}…` : cleaned;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '无法读取源视频';
}
