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
  DEFAULT_ADVANCED_SETTINGS,
  isAudioBitrateKbps,
  isAudioMode,
  isAudioOnlyFormat,
  isCrfInRange,
  isOutputFormat,
  isQualityPresetId,
  isResolutionPresetId,
} from '../../../../shared/conversion';
import { createLogger } from '../logger';
import { isConversionHistoryStatus } from '../../../../shared/history';
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
  /** 仅在任务首次进入 completed/failed/canceled 时调用。 */
  onTerminal?: (
    job: ConversionJob,
    settings: ConversionSettings | null,
  ) => void;
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
  private readonly terminalNotified = new Set<string>();
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
      advanced: {
        ...DEFAULT_ADVANCED_SETTINGS,
        ...settings.advanced,
      },
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
            normalizedSettings,
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
            normalizedSettings,
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
      const settings = this.jobSettings.get(job.id) ?? null;
      job.status = 'canceled';
      job.finishedAt = this.now();
      job.elapsedMs = 0;
      job.speed = null;
      job.etaSeconds = null;
      this.jobSettings.delete(job.id);
      logger.info('Queued conversion canceled', { jobId });
      this.emit(job);
      this.finishTerminal(job, settings);
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
        job.elapsedMs = 0;
        job.speed = null;
        job.etaSeconds = null;
        this.emit(job);

        const controller = new AbortController();
        this.active = { jobId: job.id, controller };

        try {
          const result = await this.dependencies.runJob(
            { ...job },
            settings,
            {
              signal: controller.signal,
              onProgress: (progress, telemetry) => {
                if (job.status === 'running' && Number.isFinite(progress)) {
                  job.progress = Math.max(0, Math.min(99, Math.floor(progress)));
                  if (telemetry) {
                    job.speed = telemetry.speed;
                    job.etaSeconds = telemetry.etaSeconds;
                  }
                  job.elapsedMs = this.elapsedSince(job);
                  this.emit(job);
                }
              },
            },
          );

          job.outputPath = result.outputPath;
          job.progress = 100;
          job.status = 'completed';
          job.error = null;
          this.finishTelemetry(job);
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
            this.finishTelemetry(job);
            logger.info('Conversion job canceled', { jobId: job.id });
          } else {
            job.status = 'failed';
            job.error = toErrorMessage(error);
            job.logExcerpt =
              error instanceof ConversionError ? error.logExcerpt : null;
            this.finishTelemetry(job);
            logger.warn('Conversion job failed', {
              jobId: job.id,
              error: job.error,
              logExcerpt: job.logExcerpt,
            });
          }
        } finally {
          this.active = null;
          const settingsSnapshot = this.jobSettings.get(job.id) ?? null;
          this.jobSettings.delete(job.id);
          this.emit(job);
          this.finishTerminal(job, settingsSnapshot);
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

  private recordFailure(
    sourcePath: string,
    error: string,
    settings: ConversionSettings,
  ): ConversionJob {
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
    this.finishTerminal(failed, settings);
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
      elapsedMs: null,
      speed: null,
      etaSeconds: null,
    };
  }

  private markFailed(job: ConversionJob, message: string): void {
    const settings = this.jobSettings.get(job.id) ?? null;
    job.status = 'failed';
    job.error = message;
    job.finishedAt = this.now();
    job.elapsedMs = null;
    job.speed = null;
    job.etaSeconds = null;
    this.jobSettings.delete(job.id);
    this.emit(job);
    this.finishTerminal(job, settings);
  }

  private elapsedSince(job: ConversionJob): number | null {
    if (job.startedAt === null) {
      return null;
    }
    return Math.max(0, this.now() - job.startedAt);
  }

  private finishTelemetry(job: ConversionJob): void {
    job.finishedAt = this.now();
    job.elapsedMs =
      job.startedAt === null ? null : Math.max(0, job.finishedAt - job.startedAt);
    job.speed = null;
    job.etaSeconds = null;
  }

  private emit(job: ConversionJob): void {
    try {
      this.dependencies.onUpdate?.({ job: { ...job } });
    } catch (error) {
      logger.warn('Conversion update listener failed', { error });
    }
  }

  private finishTerminal(
    job: ConversionJob,
    settings: ConversionSettings | null,
  ): void {
    if (!isConversionHistoryStatus(job.status) || this.terminalNotified.has(job.id)) {
      return;
    }

    this.terminalNotified.add(job.id);
    try {
      this.dependencies.onTerminal?.({ ...job }, settings);
    } catch (error) {
      logger.warn('Conversion terminal listener failed', { error });
    }
  }

  private assertSettings(settings: ConversionSettings): void {
    if (!isOutputFormat(settings.format)) {
      throw new ConversionQueueError('不支持的输出格式');
    }
    if (!isQualityPresetId(settings.qualityPreset)) {
      throw new ConversionQueueError('不支持的质量预设');
    }

    const advanced = settings.advanced ?? DEFAULT_ADVANCED_SETTINGS;
    if (!isResolutionPresetId(advanced.resolution)) {
      throw new ConversionQueueError('不支持的分辨率');
    }
    if (
      advanced.audioBitrateKbps !== null &&
      !isAudioBitrateKbps(advanced.audioBitrateKbps)
    ) {
      throw new ConversionQueueError('不支持的音频码率');
    }
    if (
      advanced.crf !== null &&
      !isCrfInRange(advanced.crf)
    ) {
      throw new ConversionQueueError('CRF 必须是 18 到 30 的整数');
    }
    if (!isAudioMode(advanced.audioMode)) {
      throw new ConversionQueueError('不支持的音频模式');
    }
    if (isAudioOnlyFormat(settings.format) && advanced.audioMode === 'remove') {
      throw new ConversionQueueError('MP3 必须保留音轨');
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
  onTerminal?: (
    job: ConversionJob,
    settings: ConversionSettings | null,
  ) => void;
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
    onTerminal: options.onTerminal,
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '转换失败，请查看日志';
}
