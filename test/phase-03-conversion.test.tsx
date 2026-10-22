/**
 * 阶段 3 测试：真实 FFmpeg 转换、串行任务队列、进度、取消和输出安全。
 *
 * 组织方式：
 * - 阶段 3 只使用这一个测试文件，内部按流程分组。
 * - 覆盖纯参数/命名、进度解析、队列状态机、真实 FFmpeg 转码、
 *   取消子进程、preload 事件契约和转换 UI。
 *
 * 对应需求：
 * - MP4/MKV 使用真实 FFmpeg 生成输出文件。
 * - 参数按容器构造，MKV 不出现 MP4 专属参数。
 * - 进度来自 `-progress pipe:1`，未完成前最多 99%，成功退出且文件有效后才 100%。
 * - 串行执行；单个任务失败不阻塞后续任务；取消真实终止子进程。
 * - 输出使用唯一名称，绝不覆盖源文件或既有输出文件。
 * - 输出目录、格式、质量预设和任务状态都能在界面中看到。
 *
 * 真实集成用例会实际启动本机 ffmpeg/ffprobe；没有 FFmpeg 时通过 test context
 * 标记 skip，不伪装成通过。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from '../src/App';
import { createTestLogger } from './helpers/test-logger';
import { readyCapabilities } from './helpers/capabilities';
import {
  DESKTOP_API_KEYS,
  IPC_CHANNELS,
  type AppInfo,
  type DesktopAPI,
} from '../shared/ipc';
import type {
  ConversionJob,
  ConversionSettings,
  ConversionUpdate,
} from '../shared/conversion';
import type { FfmpegStatus, MediaItem, MediaMetadata } from '../shared/media';
import {
  buildConversionArgs,
  getFormatExtension,
} from '../electron/main/services/conversion/args';
import {
  buildOutputPath,
  findUniqueOutputPath,
  validateOutputDirectory,
} from '../electron/main/services/conversion/output';
import {
  FfmpegProgressParser,
  parseProgressLine,
} from '../electron/main/services/conversion/progress';
import {
  ConversionQueue,
  type ConversionQueueDependencies,
} from '../electron/main/services/conversion/queue';
import {
  ConversionError,
  ConversionRunner,
} from '../electron/main/services/conversion/runner';
import { createConversionQueue } from '../electron/main/services/conversion/queue';
import { FfmpegService } from '../electron/main/services/ffmpeg/status';
import { resolveFfmpegPaths } from '../electron/main/services/ffmpeg/resolver';
import {
  ProcessError,
  runProcess,
} from '../electron/main/services/ffmpeg/process';
import { probeMedia } from '../electron/main/services/media/probe';
import { createDesktopApi } from '../electron/preload/api';

const logger = createTestLogger('phase-03');

let fixtureRoot = '';
let ffmpegService: FfmpegService | null = null;
let ffmpegStatus: FfmpegStatus | null = null;
let ffmpegAvailable = false;

const fixtures = {
  withAudio: '',
  noAudio: '',
  corrupt: '',
};

const sampleSettings: ConversionSettings = {
  format: 'mp4',
  qualityPreset: 'compatible',
  outputDirectory: 'C:\\输出 目录',
};

/** 生成一个带音轨的 2 秒测试视频，供真实转换使用。 */
async function generateVideoWithAudio(target: string): Promise<void> {
  await runProcess({
    executable: ffmpegStatus!.ffmpegPath!,
    args: [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=30:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-shortest',
      target,
    ],
    timeoutMs: 60000,
  });
}

/** 生成一个 1 秒、无音轨的视频，验证无音轨输入仍可转换。 */
async function generateVideoWithoutAudio(target: string): Promise<void> {
  await runProcess({
    executable: ffmpegStatus!.ffmpegPath!,
    args: [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=25:duration=1',
      '-an',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5',
      '-pix_fmt',
      'yuv420p',
      target,
    ],
    timeoutMs: 60000,
  });
}

/** 创建一个独立的输出目录，避免不同用例的输出文件互相影响。 */
function createOutputDirectory(name: string): string {
  const directory = join(fixtureRoot, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'frameforge-phase03-'));

  ffmpegService = new FfmpegService({
    resolvePaths: () =>
      resolveFfmpegPaths({
        isPackaged: false,
        resourcesPath: '',
        appPath: process.cwd(),
        env: process.env,
        platform: process.platform,
      }),
  });

  ffmpegStatus = await ffmpegService.getStatus();
  ffmpegAvailable = Boolean(
    ffmpegStatus.available && ffmpegStatus.ffmpegPath && ffmpegStatus.ffprobePath,
  );

  logger.info('真实 FFmpeg 环境检测完成', {
    available: ffmpegStatus.available,
    version: ffmpegStatus.version,
    source: ffmpegStatus.source,
    error: ffmpegStatus.error,
  });

  if (!ffmpegAvailable) {
    logger.warn('真实 FFmpeg 不可用，阶段 3 的集成用例将标记为 skip');
    return;
  }

  const mediaDirectory = join(fixtureRoot, '输入 样本');
  mkdirSync(mediaDirectory, { recursive: true });
  fixtures.withAudio = join(mediaDirectory, '测试 视频.mp4');
  fixtures.noAudio = join(fixtureRoot, '无音轨 视频.mp4');
  fixtures.corrupt = join(fixtureRoot, '损坏 视频.mp4');

  await generateVideoWithAudio(fixtures.withAudio);
  await generateVideoWithoutAudio(fixtures.noAudio);
  writeFileSync(fixtures.corrupt, 'this is not a video file');
}, 120000);

afterAll(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

// ============================================================================
// 参数构造与输出命名
// ============================================================================

describe('阶段 3 / FFmpeg 参数与输出命名', () => {
  it('MP4 使用 H.264、AAC、CRF 和 faststart，并开启 pipe:1 进度', () => {
    logger.info('STEP 构造带音轨 MP4 参数');
    const args = buildConversionArgs({
      inputPath: 'C:\\媒体 样本\\测试 视频.mp4',
      outputPath: 'C:\\输出 目录\\测试 视频_converted.mp4',
      format: 'mp4',
      qualityPreset: 'compatible',
      hasAudio: true,
    });

    expect(args).toContain('C:\\媒体 样本\\测试 视频.mp4');
    expect(args).toContain('C:\\输出 目录\\测试 视频_converted.mp4');
    expect(args).toContain('-c:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(args[args.indexOf('-crf') + 1]).toBe('23');
    expect(args).toContain('-c:a');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args[args.indexOf('-b:a') + 1]).toBe('192k');
    expect(args).toContain('-movflags');
    expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');
    expect(args).toContain('-progress');
    expect(args[args.indexOf('-progress') + 1]).toBe('pipe:1');
    expect(args).toContain('-nostats');
    expect(args).toContain('-map');
    expect(args[args.indexOf('-map') + 1]).toBe('0:v:0');
  });

  it('MKV 不添加只适用于 MP4 的 faststart 参数', () => {
    logger.info('STEP 构造 MKV 参数');
    const args = buildConversionArgs({
      inputPath: 'C:\\媒体 样本\\测试 视频.mp4',
      outputPath: 'C:\\输出 目录\\测试 视频_converted.mkv',
      format: 'mkv',
      qualityPreset: 'quality',
      hasAudio: true,
    });

    expect(args).not.toContain('-movflags');
    expect(args[args.indexOf('-crf') + 1]).toBe('20');
    expect(getFormatExtension('mp4')).toBe('mp4');
    expect(getFormatExtension('mkv')).toBe('mkv');
  });

  it('无音轨输入使用 -an，不伪造音轨', () => {
    logger.info('STEP 构造无音轨参数');
    const args = buildConversionArgs({
      inputPath: 'C:\\媒体 样本\\无音轨.mp4',
      outputPath: 'C:\\输出 目录\\无音轨_converted.mp4',
      format: 'mp4',
      qualityPreset: 'compact',
      hasAudio: false,
    });

    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
    expect(args[args.indexOf('-crf') + 1]).toBe('28');
  });

  it('输出名使用 _converted，冲突时依次生成 (1)、(2)', async () => {
    logger.info('STEP 生成基础输出名和冲突名');
    const base = buildOutputPath('C:\\输出 目录', '测试 视频.mp4', 'mp4');
    const first = buildOutputPath('C:\\输出 目录', '测试 视频.mp4', 'mp4', 1);
    const second = buildOutputPath('C:\\输出 目录', '测试 视频.mp4', 'mp4', 2);

    expect(base).toBe('C:\\输出 目录\\测试 视频_converted.mp4');
    expect(first).toBe('C:\\输出 目录\\测试 视频_converted (1).mp4');
    expect(second).toBe('C:\\输出 目录\\测试 视频_converted (2).mp4');

    logger.info('STEP 通过可注入的冲突检查寻找唯一名称');
    const taken = new Set([base.toLowerCase(), first.toLowerCase()]);
    const unique = await findUniqueOutputPath(
      'C:\\输出 目录',
      '测试 视频.mp4',
      'mp4',
      async (candidate) => taken.has(candidate.toLowerCase()),
    );
    expect(unique).toBe(second);
  });

  it('校验输出目录存在、是目录且可写', async () => {
    if (!fixtureRoot) {
      return;
    }

    const existing = createOutputDirectory('可写 输出');
    logger.info('STEP 校验真实可写目录');
    await expect(validateOutputDirectory(existing)).resolves.toMatchObject({
      ok: true,
      path: existing,
    });

    logger.info('STEP 拒绝不存在目录和文件路径');
    await expect(
      validateOutputDirectory(join(fixtureRoot, '不存在 目录')),
    ).resolves.toMatchObject({ ok: false });
    await expect(validateOutputDirectory(fixtures.withAudio)).resolves.toMatchObject({
      ok: false,
    });
  });
});

// ============================================================================
// 进度解析
// ============================================================================

describe('阶段 3 / FFmpeg 进度解析', () => {
  it('解析 out_time_us、out_time_ms 和 timecode，end 不直接表示 100%', () => {
    logger.info('STEP 解析微秒字段');
    expect(parseProgressLine('out_time_us=1500000')).toMatchObject({
      outTimeMs: 1500,
      ended: false,
    });
    expect(parseProgressLine('out_time_ms=2500000')).toMatchObject({
      outTimeMs: 2500,
      ended: false,
    });

    logger.info('STEP 解析 timecode 和结束标记');
    expect(parseProgressLine('out_time=00:00:03.500000')).toMatchObject({
      outTimeMs: 3500,
      ended: false,
    });
    expect(parseProgressLine('progress=end')).toMatchObject({
      outTimeMs: null,
      ended: true,
    });
    expect(parseProgressLine('not a progress line')).toMatchObject({
      outTimeMs: null,
      ended: false,
    });
  });

  it('按块解析进度、处理跨块行，未成功前最多 99%', () => {
    logger.info('STEP 把一行拆成多个 chunk');
    const updates: number[] = [];
    const parser = new FfmpegProgressParser(4000, (progress) => {
      updates.push(progress);
    });

    parser.push('out_time_us=100000');
    parser.push('0\nprogress=continue\n');
    expect(updates).toEqual([25]);

    logger.info('STEP 超过时长时封顶 99，progress=end 也不提前到 100');
    parser.push('out_time_us=99000000\nprogress=end\n');
    expect(updates.at(-1)).toBe(99);
    expect(updates).not.toContain(100);
  });

  it('未知时长或非法进度值不会产生 NaN', () => {
    logger.info('STEP 使用未知时长和非法值');
    const updates: number[] = [];
    const parser = new FfmpegProgressParser(null, (progress) => updates.push(progress));

    parser.push('out_time_us=1000000\n');
    parser.push('out_time_us=N/A\n');
    parser.push('out_time=not-a-time\n');

    expect(updates).toEqual([]);
    expect(updates.every((value) => Number.isFinite(value))).toBe(true);
  });
});

// ============================================================================
// 队列状态机（注入可控 runJob）
// ============================================================================

function createQueueDependencies(
  runJob: ConversionQueueDependencies['runJob'],
  overrides: Partial<ConversionQueueDependencies> = {},
): ConversionQueueDependencies {
  let sequence = 0;

  return {
    runJob,
    validateSource: async (path) => ({ ok: true, path }),
    validateOutputDirectory: async (directory) => ({ ok: true, path: directory }),
    findOutputPath: async (directory, fileName, format) =>
      buildOutputPath(directory, fileName, format),
    pathExists: async () => false,
    generateId: () => `job-${++sequence}`,
    now: () => 1_700_000_000_000 + sequence,
    ...overrides,
  };
}

describe('阶段 3 / 串行队列状态机', () => {
  it('严格串行执行；一个任务失败不阻塞后续任务', async () => {
    const starts: string[] = [];
    let active = 0;
    let maxActive = 0;

    const queue = new ConversionQueue(
      createQueueDependencies(async (job, _settings, { onProgress }) => {
        starts.push(job.fileName);
        active += 1;
        maxActive = Math.max(maxActive, active);
        onProgress(30);

        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;

        if (job.fileName.includes('bad')) {
          throw new ConversionError('转换失败：模拟编码错误', 'simulated stderr');
        }

        return { outputPath: job.outputPath };
      }),
    );

    logger.info('STEP 入队三个任务，其中第二个失败');
    const jobs = await queue.enqueue(
      ['C:\\videos\\a.mp4', 'C:\\videos\\bad.mp4', 'C:\\videos\\c.mp4'],
      sampleSettings,
    );
    await queue.waitForIdle();

    logger.info('STEP 断言没有并发、失败隔离和状态转换', {
      starts,
      statuses: queue.getJobs().map((job) => job.status),
    });
    expect(jobs).toHaveLength(3);
    expect(starts).toEqual(['a.mp4', 'bad.mp4', 'c.mp4']);
    expect(maxActive).toBe(1);
    expect(queue.getJobs().map((job) => job.status)).toEqual([
      'completed',
      'failed',
      'completed',
    ]);
    expect(queue.getJobs()[1].error).toContain('模拟编码错误');
    expect(queue.getJobs()[1].logExcerpt).toContain('simulated stderr');
    expect(queue.getJobs()[0].progress).toBe(100);
  });

  it('取消正在运行的任务会中止 signal 并标记为 canceled', async () => {
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const observed = { signal: null as AbortSignal | null };
    let runCount = 0;

    const queue = new ConversionQueue(
      createQueueDependencies(async (job, _settings, { signal, onProgress }) => {
        runCount += 1;
        observed.signal = signal;
        onProgress(10);
        resolveStarted();

        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('canceled')), {
            once: true,
          });
        });

        return { outputPath: job.outputPath };
      }),
    );

    const [job] = await queue.enqueue(['C:\\videos\\long.mp4'], sampleSettings);
    await started;
    logger.info('STEP 取消正在运行的 job');
    queue.cancel(job.id);
    await queue.waitForIdle();

    expect(observed.signal?.aborted).toBe(true);
    expect(runCount).toBe(1);
    expect(queue.getJobs()[0].status).toBe('canceled');
    expect(queue.getJobs()[0].finishedAt).not.toBeNull();
  });

  it('取消排队中的任务不会启动对应 runJob', async () => {
    let resolveFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    const startedFiles: string[] = [];

    const queue = new ConversionQueue(
      createQueueDependencies(async (job, _settings, { signal }) => {
        startedFiles.push(job.fileName);
        resolveFirstStarted();

        if (job.fileName === 'first.mp4') {
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('canceled')), {
              once: true,
            });
          });
        }

        return { outputPath: job.outputPath };
      }),
    );

    logger.info('STEP 让第一个任务阻塞，取消第二个排队任务');
    const jobs = await queue.enqueue(
      ['C:\\videos\\first.mp4', 'C:\\videos\\second.mp4'],
      sampleSettings,
    );
    await firstStarted;
    queue.cancel(jobs[1].id);

    expect(queue.getJobs()[1].status).toBe('canceled');

    queue.cancel(jobs[0].id);
    await queue.waitForIdle();

    expect(startedFiles).toEqual(['first.mp4']);
    expect(queue.getJobs()[0].status).toBe('canceled');
  });
});

// ============================================================================
// 真实 FFmpeg 转换
// ============================================================================

describe('阶段 3 / 真实 FFmpeg 转换', () => {
  it('真实转换为 MP4，成功退出且输出文件有效后才标记 completed', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegService) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    const outputDirectory = createOutputDirectory('MP4 成功输出');
    const updates: ConversionJob[] = [];
    const queue = createConversionQueue({
      ffmpeg: ffmpegService,
      onUpdate: ({ job: updated }) => updates.push(updated),
    });
    logger.info('STEP 入队真实 MP4 转换', {
      input: fixtures.withAudio,
      outputDirectory,
    });

    const [job] = await queue.enqueue([fixtures.withAudio], {
      ...sampleSettings,
      outputDirectory,
    });
    await queue.waitForIdle();

    logger.info('STEP 检查任务状态和输出文件', {
      status: queue.getJobs()[0].status,
      progress: queue.getJobs()[0].progress,
      outputPath: queue.getJobs()[0].outputPath,
    });
    const finished = queue.getJobs()[0];
    expect(finished.status).toBe('completed');
    expect(finished.progress).toBe(100);
    expect(finished.error).toBeNull();
    expect(existsSync(finished.outputPath)).toBe(true);

    const midProgress = updates.filter(
      (update) =>
        update.status === 'running' &&
        update.progress > 0 &&
        update.progress < 100,
    );
    logger.info('STEP 确认真实 FFmpeg 进度事件已到达队列', {
      progressValues: midProgress.map((update) => update.progress),
    });
    expect(midProgress.length).toBeGreaterThan(0);

    const outputMetadata = await probeMedia(
      ffmpegStatus!.ffprobePath!,
      finished.outputPath,
    );
    expect(outputMetadata.containerFormat).toBe('MP4');
    expect(outputMetadata.videoCodec).toBe('H.264');
    expect(outputMetadata.hasAudio).toBe(true);
    expect(outputMetadata.durationMs).toBeGreaterThan(3000);

    logger.info('STEP 确认源文件没有被覆盖', { source: fixtures.withAudio });
    expect(existsSync(fixtures.withAudio)).toBe(true);
    expect(job.outputPath).not.toBe(fixtures.withAudio);
  });

  it('真实转换为 MKV，无音轨输入仍成功且没有伪造音轨', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegService) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    const outputDirectory = createOutputDirectory('MKV 无音轨输出');
    const queue = createConversionQueue({ ffmpeg: ffmpegService });
    logger.info('STEP 入队无音轨 MKV 转换');

    await queue.enqueue([fixtures.noAudio], {
      ...sampleSettings,
      format: 'mkv',
      outputDirectory,
    });
    await queue.waitForIdle();

    const finished = queue.getJobs()[0];
    expect(finished.status).toBe('completed');
    expect(finished.outputPath.toLowerCase().endsWith('.mkv')).toBe(true);

    const outputMetadata = await probeMedia(
      ffmpegStatus!.ffprobePath!,
      finished.outputPath,
    );
    expect(outputMetadata.containerFormat).toBe('MKV');
    expect(outputMetadata.videoCodec).toBe('H.264');
    expect(outputMetadata.hasAudio).toBe(false);
    expect(outputMetadata.audioCodec).toBeNull();
  });

  it('真实文件名冲突时生成唯一名称，不覆盖既有文件', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegService) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    const outputDirectory = createOutputDirectory('重名 输出');
    const existingPath = buildOutputPath(
      outputDirectory,
      basename(fixtures.withAudio),
      'mp4',
    );
    await writeFile(existingPath, 'DO NOT OVERWRITE', 'utf8');

    const queue = createConversionQueue({ ffmpeg: ffmpegService });
    logger.info('STEP 在目标文件已存在时入队转换', { existingPath });

    await queue.enqueue([fixtures.withAudio], {
      ...sampleSettings,
      outputDirectory,
    });
    await queue.waitForIdle();

    const finished = queue.getJobs()[0];
    logger.info('STEP 断言新名称和旧文件内容', {
      outputPath: finished.outputPath,
    });
    expect(finished.status).toBe('completed');
    expect(finished.outputPath).not.toBe(existingPath);
    expect(basename(finished.outputPath)).toMatch(
      /_converted \(1\)\.mp4$/,
    );
    expect(await readFile(existingPath, 'utf8')).toBe('DO NOT OVERWRITE');
  });

  it('损坏输入标记 failed，输出目录不留下临时文件', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegService) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    const outputDirectory = createOutputDirectory('失败 输出');
    const queue = createConversionQueue({ ffmpeg: ffmpegService });
    logger.info('STEP 入队损坏视频');

    await queue.enqueue([fixtures.corrupt], {
      ...sampleSettings,
      outputDirectory,
    });
    await queue.waitForIdle();

    const finished = queue.getJobs()[0];
    logger.info('STEP 检查失败状态和残留文件', {
      status: finished.status,
      error: finished.error,
      files: readdirSync(outputDirectory),
    });
    expect(finished.status).toBe('failed');
    expect(finished.error).toMatch(/转换失败|无法读取|moov|Invalid|损坏/);
    expect(finished.progress).toBeLessThan(100);
    expect(readdirSync(outputDirectory)).toEqual([]);
  });

  it('真实 FFmpeg 子进程可以被 AbortSignal 终止', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegStatus?.ffmpegPath) {
      skip('本机没有可用的 ffmpeg');
      return;
    }

    const outputPath = join(fixtureRoot, 'aborted-output.mp4');
    const controller = new AbortController();
    const startedAt = Date.now();

    logger.info('STEP 启动长耗时真实编码，并在 300ms 后 abort');
    const promise = runProcess({
      executable: ffmpegStatus.ffmpegPath,
      args: [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=640x360:rate=30:duration=60',
        '-c:v',
        'libx264',
        '-preset',
        'veryslow',
        '-an',
        outputPath,
      ],
      signal: controller.signal,
      timeoutMs: 30000,
    });

    setTimeout(() => controller.abort(), 300);
    await expect(promise).rejects.toMatchObject({ code: 'ABORTED' });
    logger.info('STEP 确认进程已结束', { elapsedMs: Date.now() - startedAt });
    expect(Date.now() - startedAt).toBeLessThan(10000);

    rmSync(outputPath, { force: true });
  });
});

// ============================================================================
// Runner 失败清理（不依赖真实 FFmpeg）
// ============================================================================

describe('阶段 3 / Runner 失败清理', () => {
  it('FFmpeg 非零退出时删除临时输出并保留可读 stderr', async () => {
    if (!fixtureRoot) {
      return;
    }

    const outputDirectory = createOutputDirectory('Runner 失败输出');
    const outputPath = join(outputDirectory, 'failed.mp4');
    let capturedOutputPath = '';

    const runner = new ConversionRunner({
      getFfmpegStatus: async () => ({
        available: true,
        ffmpegPath: 'C:\\tools\\ffmpeg.exe',
        ffprobePath: 'C:\\tools\\ffprobe.exe',
        error: null,
      }),
      probe: async () => ({ durationMs: 2000, hasAudio: false }),
      runProcess: async ({ args }) => {
        capturedOutputPath = args[args.length - 1];
        writeFileSync(capturedOutputPath, 'partial output');
        throw new ProcessError(
          '进程退出码 1',
          1,
          'Error while opening encoder for output stream #0:0',
        );
      },
    });

    const job: ConversionJob = {
      id: 'runner-failure',
      sourcePath: 'C:\\videos\\bad.mp4',
      fileName: 'bad.mp4',
      outputPath,
      status: 'running',
      progress: 20,
      error: null,
      logExcerpt: null,
      startedAt: Date.now(),
      finishedAt: null,
    };

    logger.info('STEP 让 Runner 收到非零退出');
    await expect(
      runner.run(job, sampleSettings, {
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({
      name: 'ConversionError',
      logExcerpt: expect.stringContaining('opening encoder'),
    });

    expect(capturedOutputPath).not.toBe(outputPath);
    expect(existsSync(capturedOutputPath)).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
  });

  it('FFmpeg 返回 0 但没有有效输出文件时仍标记失败', async () => {
    if (!fixtureRoot) {
      return;
    }

    const outputDirectory = createOutputDirectory('Runner 空输出');
    const outputPath = join(outputDirectory, 'empty.mp4');

    const runner = new ConversionRunner({
      getFfmpegStatus: async () => ({
        available: true,
        ffmpegPath: 'C:\\tools\\ffmpeg.exe',
        ffprobePath: 'C:\\tools\\ffprobe.exe',
        error: null,
      }),
      probe: async () => ({ durationMs: 2000, hasAudio: false }),
      runProcess: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });

    const job: ConversionJob = {
      id: 'runner-empty-output',
      sourcePath: 'C:\\videos\\empty.mp4',
      fileName: 'empty.mp4',
      outputPath,
      status: 'running',
      progress: 99,
      error: null,
      logExcerpt: null,
      startedAt: Date.now(),
      finishedAt: null,
    };

    logger.info('STEP 模拟 FFmpeg 退出码 0 但没有写出文件');
    await expect(
      runner.run(job, sampleSettings, {
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({
      name: 'ConversionError',
      message: expect.stringContaining('没有生成有效的输出文件'),
    });

    expect(existsSync(outputPath)).toBe(false);
  });
});

// ============================================================================
// preload 契约
// ============================================================================

describe('阶段 3 / 转换 preload 契约', () => {
  it('暴露转换设置、启动、取消和进度订阅，不暴露危险能力', async () => {
    logger.info('STEP 检查 DesktopAPI 键');
    expect([...DESKTOP_API_KEYS].sort()).toEqual([
      'cancelConversion',
      'copyText',
      'getAppInfo',
      'getConversionCapabilities',
      'getFfmpegStatus',
      'getPathForFile',
      'importVideos',
      'onConversionUpdate',
      'openLogDirectory',
      'openOutputFile',
      'selectOutputDirectory',
      'selectVideos',
      'showOutputInFolder',
      'startConversions',
    ]);

    for (const forbidden of [
      'runCommand',
      'exec',
      'spawn',
      'ipcRenderer',
      'fs',
      'readFile',
      'writeFile',
      'showOpenDialog',
    ]) {
      expect(DESKTOP_API_KEYS).not.toContain(forbidden);
    }

    logger.info('STEP 验证新增 IPC 通道和事件取消订阅');
    const invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === IPC_CHANNELS.selectOutputDirectory) return 'C:\\输出';
      if (channel === IPC_CHANNELS.startConversions) return [];
      if (channel === IPC_CHANNELS.cancelConversion) return undefined;
      return payload;
    });
    let receivedChannel = '';
    const captured: { listener: ((payload: unknown) => void) | null } = {
      listener: null,
    };
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((channel: string, listener: (payload: unknown) => void) => {
      receivedChannel = channel;
      captured.listener = listener;
      return unsubscribe;
    });
    const api = createDesktopApi(invoke, subscribe);

    await api.selectOutputDirectory();
    await api.startConversions({
      sourcePaths: ['C:\\videos\\a.mp4'],
      settings: sampleSettings,
    });
    await api.cancelConversion('job-1');

    const updates: ConversionUpdate[] = [];
    const remove = api.onConversionUpdate((update) => updates.push(update));
    captured.listener?.({ job: { id: 'job-1' } });

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.selectOutputDirectory,
      IPC_CHANNELS.startConversions,
      IPC_CHANNELS.cancelConversion,
    ]);
    expect(receivedChannel).toBe(IPC_CHANNELS.conversionUpdate);
    expect(updates).toHaveLength(1);
    expect(remove).toBe(unsubscribe);
  });
});

// ============================================================================
// 转换 UI
// ============================================================================

const readyStatus: FfmpegStatus = {
  available: true,
  ffmpegPath: 'C:\\tools\\ffmpeg.exe',
  ffprobePath: 'C:\\tools\\ffprobe.exe',
  version: '8.0.1',
  ffprobeVersion: '8.0.1',
  source: 'system',
  error: null,
};

const appInfo: AppInfo = {
  name: 'FrameForge',
  version: '0.1.0',
  electronVersion: '45.0.0',
  chromeVersion: '140.0.0',
  nodeVersion: '24.0.0',
  platform: 'win32',
  arch: 'x64',
};

const sampleMetadata: MediaMetadata = {
  path: 'C:\\媒体 样本\\测试 视频.mp4',
  fileName: '测试 视频.mp4',
  durationMs: 2000,
  width: 320,
  height: 240,
  frameRate: 30,
  containerFormat: 'MP4',
  videoCodec: 'H.264',
  audioCodec: 'AAC',
  hasAudio: true,
  fileSizeBytes: 1536,
};

const sampleItem: MediaItem = {
  path: sampleMetadata.path,
  fileName: sampleMetadata.fileName,
  metadata: sampleMetadata,
  thumbnailDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
  thumbnailError: null,
  error: null,
};

const queuedJob: ConversionJob = {
  id: 'job-1',
  sourcePath: sampleItem.path,
  fileName: sampleItem.fileName,
  outputPath: 'C:\\输出 目录\\测试 视频_converted.mp4',
  status: 'queued',
  progress: 0,
  error: null,
  logExcerpt: null,
  startedAt: null,
  finishedAt: null,
};

function stubDesktopApi(overrides: Partial<DesktopAPI> = {}) {
  const updateListeners: Array<(update: ConversionUpdate) => void> = [];
  const api: DesktopAPI = {
    getAppInfo: vi.fn().mockResolvedValue(appInfo),
    getFfmpegStatus: vi.fn().mockResolvedValue(readyStatus),
    getConversionCapabilities: vi.fn().mockResolvedValue(readyCapabilities),
    selectVideos: vi.fn().mockResolvedValue([]),
    importVideos: vi.fn().mockResolvedValue([]),
    getPathForFile: vi.fn(() => ''),
    selectOutputDirectory: vi.fn().mockResolvedValue(null),
    startConversions: vi.fn().mockResolvedValue([]),
    cancelConversion: vi.fn().mockResolvedValue(undefined),
    openOutputFile: vi.fn().mockResolvedValue(undefined),
    showOutputInFolder: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn().mockResolvedValue(undefined),
    openLogDirectory: vi.fn().mockResolvedValue(undefined),
    onConversionUpdate: vi.fn((listener: (update: ConversionUpdate) => void) => {
      updateListeners.push(listener);
      return () => {
        const index = updateListeners.indexOf(listener);
        if (index >= 0) {
          updateListeners.splice(index, 1);
        }
      };
    }),
    ...overrides,
  };

  Object.defineProperty(window, 'desktopAPI', {
    configurable: true,
    value: api,
  });

  return {
    api,
    emitUpdate: (update: ConversionUpdate) => {
      for (const listener of [...updateListeners]) {
        listener(update);
      }
    },
  };
}

/** 导入一个真实结构的媒体项，并等待转换设置出现。 */
async function renderAppWithImportedItem(overrides: Partial<DesktopAPI> = {}) {
  const harness = stubDesktopApi({
    selectVideos: vi.fn().mockResolvedValue([sampleItem]),
    ...overrides,
  });

  render(<App />);
  expect(await screen.findByText('FFmpeg 已就绪')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /导入视频/ }));
  expect(await screen.findByText('测试 视频.mp4')).toBeInTheDocument();

  return harness;
}

describe('阶段 3 / 转换 UI', () => {
  beforeEach(() => {
    stubDesktopApi();
  });

  it('导入后显示格式、质量预设和输出目录；未选目录不能开始', async () => {
    await renderAppWithImportedItem();

    logger.info('STEP 检查设置区和真实可用的控件');
    expect(screen.getByText('转换设置')).toBeInTheDocument();
    expect(screen.getByLabelText('输出格式')).toHaveValue('mp4');
    expect(screen.getByLabelText('质量预设')).toHaveValue('compatible');
    expect(screen.getByText('未选择输出目录')).toBeInTheDocument();

    const start = screen.getByRole('button', { name: '开始转换' });
    expect(start).toBeDisabled();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();

    logger.info('STEP 选择输出目录后开始按钮才可用');
    stubDesktopApi({
      selectVideos: vi.fn().mockResolvedValue([]),
      selectOutputDirectory: vi.fn().mockResolvedValue('C:\\输出 目录'),
    });
    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    await waitFor(() => {
      expect(screen.getByText('C:\\输出 目录')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '开始转换' })).toBeEnabled();
  });

  it('开始转换时提交真实路径、格式、预设和输出目录', async () => {
    const startConversions = vi.fn().mockResolvedValue([queuedJob]);
    await renderAppWithImportedItem({
      selectOutputDirectory: vi.fn().mockResolvedValue('C:\\输出 目录'),
      startConversions,
    });

    logger.info('STEP 选择目录并切换格式/预设');
    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    await screen.findByText('C:\\输出 目录');
    fireEvent.change(screen.getByLabelText('输出格式'), {
      target: { value: 'mkv' },
    });
    fireEvent.change(screen.getByLabelText('质量预设'), {
      target: { value: 'quality' },
    });

    logger.info('STEP 点击开始转换并断言提交的请求');
    fireEvent.click(screen.getByRole('button', { name: '开始转换' }));

    await waitFor(() => {
      expect(startConversions).toHaveBeenCalledWith({
        sourcePaths: [sampleItem.path],
        settings: {
          format: 'mkv',
          qualityPreset: 'quality',
          outputDirectory: 'C:\\输出 目录',
        },
      });
    });
    expect(await screen.findByText('排队中')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('button', { name: '开始转换' })).toBeDisabled();
  });

  it('只根据真实更新显示进度、完成和失败详情，不使用假进度', async () => {
    const startConversions = vi.fn().mockResolvedValue([queuedJob]);
    const harness = await renderAppWithImportedItem({
      selectOutputDirectory: vi.fn().mockResolvedValue('C:\\输出 目录'),
      startConversions,
    });

    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    await screen.findByText('C:\\输出 目录');
    fireEvent.click(screen.getByRole('button', { name: '开始转换' }));
    await screen.findByText('排队中');

    logger.info('STEP 等待 100ms，确认没有定时器伪造进度');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    logger.info('STEP 注入 running 更新');
    await act(async () => {
      harness.emitUpdate({
        job: {
          ...queuedJob,
          status: 'running',
          progress: 42,
          startedAt: 1_700_000_000_000,
        },
      });
    });
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('转换中')).toBeInTheDocument();

    logger.info('STEP 注入 failed 更新和日志摘要');
    await act(async () => {
      harness.emitUpdate({
        job: {
          ...queuedJob,
          status: 'failed',
          progress: 42,
          error: '转换失败：编码器错误',
          logExcerpt: 'Error while opening encoder',
          finishedAt: 1_700_000_000_100,
        },
      });
    });
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText(/转换失败：编码器错误/)).toBeInTheDocument();
    expect(screen.getByText('查看详细日志')).toBeInTheDocument();
    expect(screen.getByText('Error while opening encoder')).toBeInTheDocument();
  });

  it('取消按钮调用真实取消 API，并在事件到达后显示已取消', async () => {
    const cancelConversion = vi.fn().mockResolvedValue(undefined);
    const harness = await renderAppWithImportedItem({
      selectOutputDirectory: vi.fn().mockResolvedValue('C:\\输出 目录'),
      startConversions: vi.fn().mockResolvedValue([queuedJob]),
      cancelConversion,
    });

    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    await screen.findByText('C:\\输出 目录');
    fireEvent.click(screen.getByRole('button', { name: '开始转换' }));
    await screen.findByText('排队中');

    logger.info('STEP 注入 running 更新后点击取消');
    await act(async () => {
      harness.emitUpdate({
        job: { ...queuedJob, status: 'running', progress: 25 },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));

    await waitFor(() => {
      expect(cancelConversion).toHaveBeenCalledWith(queuedJob.id);
    });

    logger.info('STEP 注入 canceled 事件，避免 UI 自己猜测取消成功');
    await act(async () => {
      harness.emitUpdate({
        job: {
          ...queuedJob,
          status: 'canceled',
          progress: 25,
          finishedAt: 1_700_000_000_200,
        },
      });
    });
    expect(screen.getByText('已取消')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /取消/ })).not.toBeInTheDocument();
  });
});
