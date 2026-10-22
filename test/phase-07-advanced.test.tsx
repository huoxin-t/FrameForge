/**
 * 阶段 7：高级设置、只读命令预览和动态 ETA。
 *
 * 目标：
 * - 分辨率、CRF、音频码率和音频模式由共享模型驱动，主进程完整校验；
 * - 命令预览和实际执行使用同一个参数构造函数；
 * - ETA 只来自真实 FFmpeg speed，未知时显示“估算中”；
 * - 高级设置真实改变输出，而不是只改 UI。
 *
 * 本文件先于实现编写；真实 RED 记录在 test-results/phase7-advanced-red.log。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from '../src/App';
import { parseStartConversionsRequest } from '../electron/main/services/conversion/validation';
import { FfmpegProgressParser, SpeedEstimator } from '../electron/main/services/conversion/progress';
import {
  ConversionQueue,
  createConversionQueue,
  type ConversionQueueDependencies,
} from '../electron/main/services/conversion/queue';
import { FfmpegService } from '../electron/main/services/ffmpeg/status';
import { resolveFfmpegPaths } from '../electron/main/services/ffmpeg/resolver';
import { runProcess } from '../electron/main/services/ffmpeg/process';
import { probeOutputFile } from '../electron/main/services/media/probe';
import { ConversionSettings } from '../src/components/ConversionSettings';
import { JobQueue } from '../src/components/JobQueue';
import { buildConversionArgs, formatCommandForDisplay } from '../shared/conversion-args';
import {
  DEFAULT_ADVANCED_SETTINGS,
  buildPreviewOutputPath,
  type AdvancedConversionSettings,
  type ConversionJob,
  type ConversionSettings as ConversionSettingsValue,
} from '../shared/conversion';
import type {
  FfmpegStatus,
  MediaItem,
} from '../shared/media';
import type { AppInfo, DesktopAPI } from '../shared/ipc';
import { readyCapabilities } from './helpers/capabilities';
import { createTestLogger } from './helpers/test-logger';

const logger = createTestLogger('phase-07');

let fixtureRoot = '';
let ffmpegService: FfmpegService | null = null;
let ffmpegStatus: FfmpegStatus | null = null;
let ffmpegAvailable = false;
let largeFixture = '';

function advanced(
  overrides: Partial<AdvancedConversionSettings> = {},
): AdvancedConversionSettings {
  return { ...DEFAULT_ADVANCED_SETTINGS, ...overrides };
}

function buildArgs(
  overrides: Partial<Parameters<typeof buildConversionArgs>[0]> = {},
): string[] {
  return buildConversionArgs({
    inputPath: 'C:\\媒体 样本\\测试 视频.mp4',
    outputPath: 'C:\\输出 目录\\测试 视频_converted.mp4',
    format: 'mp4',
    qualityPreset: 'compatible',
    hasAudio: true,
    sourceWidth: 1920,
    sourceHeight: 1080,
    advanced: advanced(),
    ...overrides,
  });
}

const baseSettings: ConversionSettingsValue = {
  format: 'mp4',
  qualityPreset: 'compatible',
  outputDirectory: 'C:\\输出 目录',
  advanced: advanced(),
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

const readyStatus: FfmpegStatus = {
  available: true,
  ffmpegPath: 'C:\\tools\\ffmpeg.exe',
  ffprobePath: 'C:\\tools\\ffprobe.exe',
  version: '8.0.1',
  ffprobeVersion: '8.0.1',
  source: 'bundled',
  error: null,
};

const appMediaItem: MediaItem = {
  path: 'C:\\媒体 样本\\测试 视频.mp4',
  fileName: '测试 视频.mp4',
  metadata: {
    path: 'C:\\媒体 样本\\测试 视频.mp4',
    fileName: '测试 视频.mp4',
    durationMs: 2000,
    width: 640,
    height: 360,
    frameRate: 30,
    containerFormat: 'MP4',
    videoCodec: 'H.264',
    audioCodec: 'AAC',
    hasAudio: true,
    fileSizeBytes: 1536,
  },
  thumbnailDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
  thumbnailError: null,
  error: null,
};

async function generateLargeVideo(target: string): Promise<void> {
  await runProcess({
    executable: ffmpegStatus!.ffmpegPath!,
    args: [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1280x720:rate=30:duration=5',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=5',
      '-c:v',
      'mpeg4',
      '-q:v',
      '4',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-shortest',
      target,
    ],
    timeoutMs: 120000,
  });
}

beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'frameforge-phase07-'));
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

  if (!ffmpegAvailable) {
    logger.warn('真实 FFmpeg 不可用，阶段 7 的真实集成用例将标记为 skip');
    return;
  }

  const mediaDirectory = join(fixtureRoot, '输入 样本');
  mkdirSync(mediaDirectory, { recursive: true });
  largeFixture = join(mediaDirectory, '高级 设置 视频.mp4');
  await generateLargeVideo(largeFixture);
}, 180000);

afterAll(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe('阶段 7 / 高级设置参数', () => {
  it('720p 使用偶数宽度的等比缩放，原始分辨率不添加滤镜', () => {
    const scaled = buildArgs({ advanced: advanced({ resolution: '720p' }) });
    expect(scaled[scaled.indexOf('-vf') + 1]).toBe('scale=-2:720:flags=lanczos');

    const original = buildArgs({ advanced: advanced({ resolution: 'original' }) });
    expect(original).not.toContain('-vf');

    const noUpscale = buildArgs({
      sourceWidth: 640,
      sourceHeight: 360,
      advanced: advanced({ resolution: '1080p' }),
    });
    expect(noUpscale).not.toContain('-vf');
  });

  it('自定义 CRF、音频码率和移除音频真实进入参数', () => {
    const args = buildArgs({
      qualityPreset: 'quality',
      advanced: advanced({
        crf: 18,
        audioBitrateKbps: 128,
        audioMode: 'remove',
      }),
    });

    expect(args[args.indexOf('-crf') + 1]).toBe('18');
    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
    expect(args).not.toContain('-b:a');
  });

  it('MP3 不允许移除音频，预览输出名使用 profile 扩展名', () => {
    expect(() =>
      buildArgs({
        format: 'mp3',
        outputPath: 'C:\\输出 目录\\测试 视频_converted.mp3',
        advanced: advanced({ audioMode: 'remove' }),
      }),
    ).toThrow('MP3 必须保留音轨');

    expect(
      buildPreviewOutputPath(
        'C:\\输出 目录',
        '测试 视频.mp4',
        'webm',
      ),
    ).toBe('C:\\输出 目录\\测试 视频_converted.webm');
  });
});

describe('阶段 7 / 命令预览', () => {
  it('预览命令包含实际参数，并对空格路径加引号', () => {
    const args = buildArgs({
      advanced: advanced({ resolution: '720p', crf: 20 }),
    });
    const command = formatCommandForDisplay('C:\\FFmpeg 目录\\ffmpeg.exe', args);

    expect(command).toContain('"C:\\FFmpeg 目录\\ffmpeg.exe"');
    expect(command).toContain('"C:\\媒体 样本\\测试 视频.mp4"');
    expect(command).toContain('scale=-2:720:flags=lanczos');
    expect(command).toContain('-crf 20');
  });

  it('主进程校验高级设置并拒绝越界值', () => {
    const valid = parseStartConversionsRequest({
      sourcePaths: ['C:\\videos\\a.mp4'],
      settings: {
        ...baseSettings,
        advanced: advanced({
          resolution: '480p',
          crf: 30,
          audioBitrateKbps: 256,
          audioMode: 'remove',
        }),
      },
    });
    expect(valid.settings.advanced).toMatchObject({
      resolution: '480p',
      crf: 30,
      audioBitrateKbps: 256,
      audioMode: 'remove',
    });

    for (const advancedValue of [
      advanced({ crf: 17 }),
      advanced({ crf: 31 }),
      advanced({ audioBitrateKbps: 96 as never }),
      advanced({ resolution: '4k' as never }),
      advanced({ audioMode: 'mute' as never }),
    ]) {
      expect(() =>
        parseStartConversionsRequest({
          sourcePaths: ['C:\\videos\\a.mp4'],
          settings: { ...baseSettings, advanced: advancedValue },
        }),
      ).toThrow();
    }

    expect(() =>
      parseStartConversionsRequest({
        sourcePaths: ['C:\\videos\\a.mp4'],
        settings: {
          ...baseSettings,
          format: 'mp3',
          advanced: advanced({ audioMode: 'remove' }),
        },
      }),
    ).toThrow('MP3 必须保留音轨');
  });
});

describe('阶段 7 / 动态 ETA', () => {
  it('解析 speed，并用最近样本平滑；未知 speed 不产生假倒计时', () => {
    expect(new SpeedEstimator().add(1.5)).toBeNull();
    const estimator = new SpeedEstimator();
    estimator.add(1.5);
    expect(estimator.add(2.5)).toBe(2);

    const updates: Array<{
      progress: number;
      speed: number | null;
      etaSeconds: number | null;
    }> = [];
    const parser = new FfmpegProgressParser(10_000, (progress, telemetry) => {
      updates.push({
        progress,
        speed: telemetry?.speed ?? null,
        etaSeconds: telemetry?.etaSeconds ?? null,
      });
    });

    parser.push('out_time_us=2000000\nspeed=1.0x\nprogress=continue\n');
    expect(updates[0]).toMatchObject({
      progress: 20,
      speed: null,
      etaSeconds: null,
    });

    parser.push('out_time_us=4000000\nspeed=3.0x\nprogress=continue\n');
    expect(updates[1]).toMatchObject({
      progress: 40,
      speed: 2,
      etaSeconds: 3,
    });

    const unknown = new FfmpegProgressParser(10_000, (progress, telemetry) => {
      updates.push({
        progress,
        speed: telemetry?.speed ?? null,
        etaSeconds: telemetry?.etaSeconds ?? null,
      });
    });
    unknown.push('out_time_us=3000000\nprogress=continue\n');
    expect(updates.at(-1)).toMatchObject({
      speed: null,
      etaSeconds: null,
    });
  });

  it('队列把真实 telemetry 写入任务，完成后清除 ETA', async () => {
    const updates: ConversionJob[] = [];
    const dependencies: ConversionQueueDependencies = {
      runJob: async (job, _settings, { onProgress }) => {
        onProgress(50, {
          outTimeMs: 2000,
          speed: 2.5,
          etaSeconds: 4,
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { outputPath: job.outputPath };
      },
      validateSource: async (path) => ({ ok: true, path }),
      validateOutputDirectory: async (directory) => ({ ok: true, path: directory }),
      findOutputPath: async (directory, fileName, format) =>
        `${directory}\\${fileName.replace(/\.[^.]+$/, '')}_converted.${format}`,
      pathExists: async () => false,
      now: () => 1_700_000_000_000,
      generateId: () => 'job-advanced',
      onUpdate: ({ job }) => updates.push({ ...job }),
    };
    const queue = new ConversionQueue(dependencies);

    const [created] = await queue.enqueue(
      ['C:\\videos\\a.mp4'],
      baseSettings,
    );
    await queue.waitForIdle();

    const running = updates.find(
      (job) => job.status === 'running' && job.speed === 2.5,
    );
    expect(running).toMatchObject({
      speed: 2.5,
      etaSeconds: 4,
    });
    expect(running?.elapsedMs).not.toBeNull();
    expect(queue.getJob(created.id)).toMatchObject({
      status: 'completed',
      speed: null,
      etaSeconds: null,
    });
  });
});

describe('阶段 7 / 高级设置与任务 UI', () => {
  function renderSettings(
    overrides: Partial<Parameters<typeof ConversionSettings>[0]> = {},
  ) {
    const handlers = {
      onFormatChange: vi.fn(),
      onQualityPresetChange: vi.fn(),
      onChooseDirectory: vi.fn(),
      onRefreshCapabilities: vi.fn(),
      onAdvancedChange: vi.fn(),
      onCopyCommand: vi.fn().mockResolvedValue(undefined),
      onStart: vi.fn(),
      ...overrides,
    };

    render(
      <ConversionSettings
        format="mp4"
        qualityPreset="compatible"
        outputDirectory="C:\\输出 目录"
        itemCount={1}
        starting={false}
        disabled={false}
        error={null}
        capabilities={readyCapabilities}
        capabilitiesLoading={false}
        capabilitiesError={null}
        audioOnlyExcludedCount={0}
        advanced={advanced()}
        commandPreview="ffmpeg -hide_banner -i test.mp4 out.mp4"
        previewNote="示例输出名"
        {...overrides}
        {...handlers}
      />,
    );

    return handlers;
  }

  it('高级面板默认折叠，修改分辨率会提交完整设置', () => {
    const handlers = renderSettings();

    expect(screen.queryByLabelText('分辨率')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('高级设置'));
    fireEvent.change(screen.getByLabelText('分辨率'), {
      target: { value: '720p' },
    });

    expect(handlers.onAdvancedChange).toHaveBeenCalledWith(
      advanced({ resolution: '720p' }),
    );
  });

  it('只读预览和复制按钮使用传入的真实命令', async () => {
    const preview = 'ffmpeg -hide_banner -i "C:\\素材 视频.mp4" out.mp4';
    const handlers = renderSettings({ commandPreview: preview });

    fireEvent.click(screen.getByText('高级设置'));
    expect(screen.getByText(preview)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制命令' }));

    await waitFor(() => {
      expect(handlers.onCopyCommand).toHaveBeenCalledWith(preview);
    });
  });

  it('运行中显示真实已用、剩余和速度；未知时显示估算中', () => {
    const runningJob: ConversionJob = {
      id: 'job-running',
      sourcePath: 'C:\\videos\\a.mp4',
      fileName: 'a.mp4',
      outputPath: 'C:\\out\\a_converted.mp4',
      status: 'running',
      progress: 40,
      error: null,
      logExcerpt: null,
      startedAt: 1000,
      finishedAt: null,
      elapsedMs: 12_000,
      speed: 2.5,
      etaSeconds: 3,
    };

    const { rerender } = render(
      <JobQueue
        jobs={[runningJob]}
        onCancel={vi.fn()}
        onOpenOutput={vi.fn()}
        onOpenOutputDirectory={vi.fn()}
        onCopyError={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(screen.getByText(/已用 00:12/)).toBeInTheDocument();
    expect(screen.getByText(/剩余约 00:03/)).toBeInTheDocument();
    expect(screen.getByText(/2\.50×/)).toBeInTheDocument();

    rerender(
      <JobQueue
        jobs={[
          {
            ...runningJob,
            speed: null,
            etaSeconds: null,
          },
        ]}
        onCancel={vi.fn()}
        onOpenOutput={vi.fn()}
        onOpenOutputDirectory={vi.fn()}
        onCopyError={vi.fn()}
        onOpenLogDirectory={vi.fn()}
      />,
    );

    expect(screen.getByText(/剩余估算中/)).toBeInTheDocument();
    expect(screen.getByText(/速度估算中/)).toBeInTheDocument();
  });

  it('App 把高级设置原样提交给主进程', async () => {
    const startConversions = vi.fn().mockResolvedValue([]);
    const api: DesktopAPI = {
      getAppInfo: vi.fn().mockResolvedValue(appInfo),
      getFfmpegStatus: vi.fn().mockResolvedValue(readyStatus),
      getConversionCapabilities: vi.fn().mockResolvedValue(readyCapabilities),
      selectVideos: vi.fn().mockResolvedValue([appMediaItem]),
      importVideos: vi.fn().mockResolvedValue([]),
      getPathForFile: vi.fn(() => ''),
      selectOutputDirectory: vi.fn().mockResolvedValue('C:\\输出 目录'),
      startConversions,
      cancelConversion: vi.fn().mockResolvedValue(undefined),
      onConversionUpdate: vi.fn(() => () => undefined),
      openOutputFile: vi.fn().mockResolvedValue(undefined),
      showOutputInFolder: vi.fn().mockResolvedValue(undefined),
      copyText: vi.fn().mockResolvedValue(undefined),
      openLogDirectory: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(window, 'desktopAPI', {
      configurable: true,
      value: api,
    });

    render(<App />);

    expect(await screen.findByText('FFmpeg 已就绪')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /导入视频/ }));
    expect(await screen.findByText('测试 视频.mp4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    await screen.findByText('C:\\输出 目录');

    fireEvent.click(screen.getByText('高级设置'));
    fireEvent.change(screen.getByLabelText('分辨率'), {
      target: { value: '720p' },
    });
    fireEvent.change(screen.getByLabelText('CRF'), {
      target: { value: '18' },
    });
    fireEvent.change(screen.getByLabelText('音频码率'), {
      target: { value: '128' },
    });
    fireEvent.change(screen.getByLabelText('音频模式'), {
      target: { value: 'remove' },
    });

    fireEvent.click(screen.getByRole('button', { name: '开始转换' }));

    await waitFor(() => {
      expect(startConversions).toHaveBeenCalledWith({
        sourcePaths: ['C:\\媒体 样本\\测试 视频.mp4'],
        settings: {
          format: 'mp4',
          qualityPreset: 'compatible',
          outputDirectory: 'C:\\输出 目录',
          advanced: {
            resolution: '720p',
            crf: 18,
            audioBitrateKbps: 128,
            audioMode: 'remove',
          },
        },
      });
    });
  });
});

describe('阶段 7 / 真实高级设置转换', () => {
  it('真实缩放、移除音频并观察到 speed/ETA', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegService || !ffmpegStatus?.ffprobePath) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    const updates: ConversionJob[] = [];
    const outputDirectory = join(fixtureRoot, '高级 输出');
    mkdirSync(outputDirectory, { recursive: true });
    const queue = createConversionQueue({
      ffmpeg: ffmpegService,
      onUpdate: ({ job }) => updates.push({ ...job }),
    });

    logger.info('START 真实 480p + 移除音频 + 自定义 CRF');
    const [job] = await queue.enqueue([largeFixture], {
      ...baseSettings,
      outputDirectory,
      qualityPreset: 'quality',
      advanced: advanced({
        resolution: '480p',
        crf: 18,
        audioBitrateKbps: 128,
        audioMode: 'remove',
      }),
    });
    await queue.waitForIdle();

    const completed = queue.getJob(job.id);
    expect(completed?.status).toBe('completed');
    const summary = await probeOutputFile(
      ffmpegStatus.ffprobePath,
      completed!.outputPath,
    );

    expect(summary.hasVideo).toBe(true);
    expect(summary.hasAudio).toBe(false);
    expect(summary.height).toBe(480);
    expect(summary.width).not.toBeNull();
    expect(summary.width! % 2).toBe(0);

    expect(
      updates.some(
        (update) =>
          update.status === 'running' &&
          (update.speed ?? 0) > 0 &&
          update.etaSeconds !== null,
      ),
    ).toBe(true);

    logger.info('PASS 真实高级设置输出与 ETA 更新', {
      width: summary.width,
      height: summary.height,
      hasAudio: summary.hasAudio,
      speedSeen: updates.some((update) => (update.speed ?? 0) > 0),
    });
  });
});
