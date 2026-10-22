/**
 * 串行转换队列。
 *
 * 队列只允许一个 FFmpeg 转换进程运行；任务失败不会清空后续任务，
 * 取消会真正 Abort 当前子进程。进度和状态由队列统一发给 renderer。
 */
import { basename } from 'node:path';
import type {
  ConversionJob,
  ConversionSettings,
} from '../../../../shared/conversion';
import {
  isAudioOnlyFormat,
  isOutputFormat,
  isQualityPresetId,
} from '../../../../shared/conversion';
import { createLogger } from '../logger';
import type { FfmpegService } from '../ffmpeg/status';
import { probeMedia, validateVideoPath } from '../media/probe';
import {
  findUniqueOutputPath,
  pathExists,
  validateOutputDirectory,
  type OutputDirectoryValidation,
} from './output';
import {
  ConversionCanceledError,
  ConversionError,
  createConversionRunner,
  type ConversionRunResult,
  type RunConversionOptions,
} from './runner';

const logger = createLogger('conversion-queue');

export interface SourceValidation {
  ok: boolean;
  path?: string;
  /** 仅音频 profile 需要；由真实 ffprobe 探测，不根据扩展名猜测。 */
  hasAudio?: boolean;
  error?: string;
}

export interface ConversionQueueDependencies {
  runJob: (
    job: ConversionJob,
    settings: ConversionSettings,
    options: RunConversionOptions,
  ) => Promise<ConversionRunResult>;
  validateSource: (
    sourcePath: string,
    settings: ConversionSettings,
  ) => Promise<SourceValidation>;
  validateOutputDirectory: (
    directory: string,
  ) => Promise<OutputDirectoryValidation>;
  findOutputPath: (
    directory: string,
    sourceFileName: string,
    format: ConversionSettings['format'],
    isTaken: (candidate: string) => boolean | Promise<boolean>,
  ) => Promise<string>;
  pathExists: (path: string) => Promise<boolean>;
  now?: () => number;
  generateId?: () => string;
  onUpdate?: (update: { job: ConversionJob }) => void;
}

export class ConversionQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionQueueError';
  }
}

interface ActiveJob {
  jobId: string;
  controller: AbortController;
}

export class ConversionQueue {
  private readonly dependencies: ConversionQueueDependencies;
  private readonly jobs: ConversionJob[] = [];
  private readonly jobSettings = new Map<string, ConversionSettings>();
  private readonly reservedOutputPaths = new Set<string>();
  private readonly idleWaiters: Array<() => void> = [];
  private active: ActiveJob | null = null;
  private draining = false;
  private sequence = 0;

  constructor(dependencies: ConversionQueueDependencies) {
    this.dependencies = dependencies;
  }

  async enqueue(
    sourcePaths: string[],
    settings: ConversionSettings,
  ): Promise<ConversionJob[]> {
    this.assertSettings(settings);

    if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
      throw new ConversionQueueError('请先导入至少一个视频');
    }

    if (sourcePaths.length > 100) {
      throw new ConversionQueueError('一次最多转换 100 个视频');
    }

    const outputValidation = await this.dependencies.validateOutputDirectory(
      settings.outputDirectory,
    );
    if (!outputValidation.ok) {
      throw new ConversionQueueError(outputValidation.error);
    }

    const normalizedSettings: ConversionSettings = {
      ...settings,
      outputDirectory: outputValidation.path,
    };

    logger.info('Enqueue conversion requested', {
      count: sourcePaths.length,
      format: settings.format,
      qualityPreset: settings.qualityPreset,
      outputDirectory: outputValidation.path,
    });

    const seen = new Set<string>();
    const created: ConversionJob[] = [];

    for (const sourcePath of sourcePaths) {
      const key = sourcePath.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const sourceValidation = await this.dependencies.validateSource(
        sourcePath,
        normalizedSettings,
      );
      if (!sourceValidation.ok || !sourceValidation.path) {
        created.push(
          this.recordFailure(
            sourcePath,
            sourceValidation.error ?? '源文件无效',
          ),
        );
        continue;
      }

      if (
        isAudioOnlyFormat(normalizedSettings.format) &&
        sourceValidation.hasAudio === false
      ) {
        created.push(
          this.recordFailure(
            sourceValidation.path,
            '该视频没有音轨，无法导出 MP3',
          ),
        );
        continue;
      }

      const fileName = basename(sourceValidation.path);
      const outputPath = await this.dependencies.findOutputPath(
        normalizedSettings.outputDirectory,
        fileName,
        normalizedSettings.format,
        async (candidate) => {
          if (this.reservedOutputPaths.has(candidate.toLowerCase())) {
            return true;
          }
          return this.dependencies.pathExists(candidate);
        },
      );

      this.reservedOutputPaths.add(outputPath.toLowerCase());
      const job = this.createJob({
        sourcePath: sourceValidation.path,
        fileName,
        outputPath,
        status: 'queued',
        error: null,
        finishedAt: null,
      });

      this.jobSettings.set(job.id, normalizedSettings);
      this.jobs.push(job);
      this.emit(job);
      created.push({ ...job });
    }

    logger.info('Conversion jobs queued', {
      count: created.length,
      ids: created.map((job) => job.id),
    });

    void this.drain();
    return created;
  }

  cancel(jobId: string): void {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      return;
    }

    if (job.status === 'queued') {
      job.status = 'canceled';
      job.finishedAt = this.now();
      this.jobSettings.delete(job.id);
      logger.info('Queued conversion canceled', { jobId });
      this.emit(job);
      this.notifyIdle();
      return;
    }

    if (job.status === 'running' && this.active?.jobId === jobId) {
      logger.info('Canceling running conversion', { jobId });
      this.active.controller.abort();
    }
  }

  getJobs(): ConversionJob[] {
    return this.jobs.map((job) => ({ ...job }));
  }

  getJob(jobId: string): ConversionJob | null {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    return job ? { ...job } : null;
  }

  hasActiveJobs(): boolean {
    return this.isBusy();
  }

  /** 取消所有排队/运行任务；用于用户确认退出应用。 */
  cancelAll(): void {
    for (const job of [...this.jobs]) {
      if (job.status === 'queued' || job.status === 'running') {
        this.cancel(job.id);
      }
    }
  }

  /** 等待队列中没有 queued/running 任务；测试和退出流程可用。 */
  waitForIdle(): Promise<void> {
    if (!this.isBusy()) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }

    this.draining = true;

    try {
      while (true) {
        const job = this.jobs.find((candidate) => candidate.status === 'queued');
        if (!job) {
          break;
        }

        const settings = this.jobSettings.get(job.id);
        if (!settings) {
          this.markFailed(job, '任务配置丢失，无法继续');
          continue;
        }

        job.status = 'running';
        job.progress = 0;
        job.startedAt = this.now();
        this.emit(job);

        const controller = new AbortController();
        this.active = { jobId: job.id, controller };

        try {
          const result = await this.dependencies.runJob(
            { ...job },
            settings,
            {
              signal: controller.signal,
              onProgress: (progress) => {
                if (job.status === 'running' && Number.isFinite(progress)) {
                  job.progress = Math.max(0, Math.min(99, Math.floor(progress)));
                  this.emit(job);
                }
              },
            },
          );

          job.outputPath = result.outputPath;
          job.progress = 100;
          job.status = 'completed';
          job.error = null;
          job.finishedAt = this.now();
          logger.info('Conversion job completed', {
            jobId: job.id,
            outputPath: job.outputPath,
          });
        } catch (error) {
          if (
            controller.signal.aborted ||
            error instanceof ConversionCanceledError
          ) {
            job.status = 'canceled';
            job.error = null;
            job.logExcerpt = null;
            job.finishedAt = this.now();
            logger.info('Conversion job canceled', { jobId: job.id });
          } else {
            job.status = 'failed';
            job.error = toErrorMessage(error);
            job.logExcerpt =
              error instanceof ConversionError ? error.logExcerpt : null;
            job.finishedAt = this.now();
            logger.warn('Conversion job failed', {
              jobId: job.id,
              error: job.error,
              logExcerpt: job.logExcerpt,
            });
          }
        } finally {
          this.active = null;
          this.jobSettings.delete(job.id);
          this.emit(job);
        }
      }
    } finally {
      this.draining = false;
      this.notifyIdle();

      // 在 drain 结束前入队的新任务需要再启动一轮。
      if (this.jobs.some((job) => job.status === 'queued')) {
        void this.drain();
      }
    }
  }

  private recordFailure(sourcePath: string, error: string): ConversionJob {
    const failed = this.createJob({
      sourcePath,
      fileName: basename(sourcePath) || sourcePath,
      outputPath: '',
      status: 'failed',
      error,
      finishedAt: this.now(),
    });
    this.jobs.push(failed);
    this.emit(failed);
    return { ...failed };
  }

  private createJob(input: {
    sourcePath: string;
    fileName: string;
    outputPath: string;
    status: ConversionJob['status'];
    error: string | null;
    finishedAt: number | null;
  }): ConversionJob {
    return {
      id: this.dependencies.generateId?.() ?? `job-${++this.sequence}`,
      sourcePath: input.sourcePath,
      fileName: input.fileName,
      outputPath: input.outputPath,
      status: input.status,
      progress: 0,
      error: input.error,
      logExcerpt: null,
      startedAt: null,
      finishedAt: input.finishedAt,
    };
  }

  private markFailed(job: ConversionJob, message: string): void {
    job.status = 'failed';
    job.error = message;
    job.finishedAt = this.now();
    this.jobSettings.delete(job.id);
    this.emit(job);
  }

  private emit(job: ConversionJob): void {
    try {
      this.dependencies.onUpdate?.({ job: { ...job } });
    } catch (error) {
      logger.warn('Conversion update listener failed', { error });
    }
  }

  private assertSettings(settings: ConversionSettings): void {
    if (!isOutputFormat(settings.format)) {
      throw new ConversionQueueError('不支持的输出格式');
    }
    if (!isQualityPresetId(settings.qualityPreset)) {
      throw new ConversionQueueError('不支持的质量预设');
    }
  }

  private isBusy(): boolean {
    return this.jobs.some(
      (job) => job.status === 'queued' || job.status === 'running',
    );
  }

  private notifyIdle(): void {
    if (this.isBusy()) {
      return;
    }

    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }
}

export interface CreateConversionQueueOptions {
  ffmpeg: Pick<FfmpegService, 'getStatus'>;
  onUpdate?: (update: { job: ConversionJob }) => void;
}

/** 用真实 FFmpeg 和 ffprobe 创建转换队列。 */
export function createConversionQueue(
  options: CreateConversionQueueOptions,
): ConversionQueue {
  const runner = createConversionRunner(options.ffmpeg);

  return new ConversionQueue({
    runJob: (job, settings, runOptions) =>
      runner.run(job, settings, runOptions),
    validateSource: async (sourcePath, settings) => {
      const validation = await validateVideoPath(sourcePath);
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }

      if (!isAudioOnlyFormat(settings.format)) {
        return { ok: true, path: validation.path };
      }

      const status = await options.ffmpeg.getStatus();
      if (!status.available || !status.ffprobePath) {
        return {
          ok: false,
          error: status.error ?? 'FFprobe 未就绪，无法检查音轨',
        };
      }

      try {
        const metadata = await probeMedia(status.ffprobePath, validation.path);
        return {
          ok: true,
          path: validation.path,
          hasAudio: metadata.hasAudio,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '无法读取音轨信息',
        };
      }
    },
    validateOutputDirectory,
    findOutputPath: findUniqueOutputPath,
    pathExists,
    onUpdate: options.onUpdate,
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '转换失败，请查看日志';
}
