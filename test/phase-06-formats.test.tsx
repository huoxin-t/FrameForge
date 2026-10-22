/**
 * 阶段 6：格式能力层与 WebM / MP3。
 *
 * 目标：
 * - OutputProfile 描述容器、编码和扩展名；
 * - ffmpeg -encoders 的真实输出可以被解析成能力矩阵；
 * - 参数构造只依赖 profile，不把 FFmpeg 参数散落到 UI；
 * - WebM 使用 VP9 + Opus，MP3 只导出音频；
 * - 无音轨输入不能伪造 MP3 音轨；
 * - UI 不展示“假可用”的格式。
 *
 * 本文件先于实现编写；真实 RED 记录在 test-results/phase6-formats-red.log。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  buildConversionArgs,
  getFormatExtension,
} from '../electron/main/services/conversion/args';
import { buildOutputPath } from '../electron/main/services/conversion/output';
import {
  ConversionQueue,
  createConversionQueue,
} from '../electron/main/services/conversion/queue';
import { assertOutputMatchesProfile } from '../electron/main/services/conversion/runner';
import { FfmpegCapabilityService } from '../electron/main/services/ffmpeg/capabilities';
import { runProcess } from '../electron/main/services/ffmpeg/process';
import { resolveFfmpegPaths } from '../electron/main/services/ffmpeg/resolver';
import { FfmpegService } from '../electron/main/services/ffmpeg/status';
import { probeOutputFile } from '../electron/main/services/media/probe';
import { ConversionSettings } from '../src/components/ConversionSettings';
import type { FfmpegStatus } from '../shared/media';
import {
  DEFAULT_ADVANCED_SETTINGS,
  OUTPUT_PROFILES,
  getOutputFormat,
  type ConversionSettings as ConversionSettingsValue,
} from '../shared/conversion';
import {
  ALL_ENCODERS_AVAILABLE,
  buildConversionCapabilities,
  getFormatCapability,
  parseEncoderList,
} from '../shared/capabilities';
import { createTestLogger } from './helpers/test-logger';

const logger = createTestLogger('phase-06');

let fixtureRoot = '';
let ffmpegService: FfmpegService | null = null;
let ffmpegStatus: FfmpegStatus | null = null;
let ffmpegAvailable = false;

const fixtures = {
  withAudio: '',
  noAudio: '',
};

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
      'testsrc=size=320x240:rate=25:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
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

beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'frameforge-phase06-'));

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
    available: ffmpegAvailable,
    version: ffmpegStatus.version,
    source: ffmpegStatus.source,
  });

  if (!ffmpegAvailable) {
    return;
  }

  const mediaDirectory = join(fixtureRoot, '输入 样本');
  mkdirSync(mediaDirectory, { recursive: true });
  fixtures.withAudio = join(mediaDirectory, '格式 测试 视频.mp4');
  fixtures.noAudio = join(fixtureRoot, '无音轨 格式 测试.mp4');
  await generateVideoWithAudio(fixtures.withAudio);
  await generateVideoWithoutAudio(fixtures.noAudio);
}, 120000);

afterAll(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function createOutputDirectory(name: string): string {
  const directory = join(fixtureRoot, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

const sampleEncoders = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 ------
 V....D libx264              H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
 A....D libopus              libopus Opus (codec opus)
 A....D libmp3lame           libmp3lame MP3 (MPEG audio layer 3) (codec mp3)
`;

function renderSettings(
  overrides: Partial<Parameters<typeof ConversionSettings>[0]> = {},
) {
  const handlers = {
    onFormatChange: vi.fn(),
    onQualityPresetChange: vi.fn(),
    onAdvancedChange: vi.fn(),
    onChooseDirectory: vi.fn(),
    onRefreshCapabilities: vi.fn(),
    onCopyCommand: vi.fn().mockResolvedValue(undefined),
    onStart: vi.fn(),
    ...overrides,
  };

  const capabilities = overrides.capabilities ?? readyCapabilities;

  render(
    <ConversionSettings
      format="mp4"
      qualityPreset="compatible"
      outputDirectory="C:\\输出 目录"
      itemCount={1}
      starting={false}
      disabled={false}
      error={null}
      capabilities={capabilities}
      capabilitiesLoading={false}
      capabilitiesError={null}
      audioOnlyExcludedCount={0}
      advanced={{ ...DEFAULT_ADVANCED_SETTINGS }}
      commandPreview="ffmpeg -hide_banner -i test.mp4 out.mp4"
      previewNote="示例输出"
      {...overrides}
      {...handlers}
    />,
  );

  return handlers;
}

const readyCapabilities = buildConversionCapabilities(ALL_ENCODERS_AVAILABLE, {
  checkedAt: 0,
  ffmpegVersion: '8.0.1',
});

const missingWebmCapabilities = buildConversionCapabilities(
  {
    ...ALL_ENCODERS_AVAILABLE,
    'libvpx-vp9': false,
    libopus: false,
  },
  {
    checkedAt: 0,
    ffmpegVersion: '8.0.1',
  },
);

// ============================================================================
// OutputProfile 与能力矩阵
// ============================================================================

describe('阶段 6 / OutputProfile 与编码器能力', () => {
  it('格式矩阵包含 MP4、MKV、WebM 和仅音频 MP3', () => {
    logger.info('START 检查 OutputProfile 矩阵');

    expect(OUTPUT_PROFILES.map((profile) => profile.id)).toEqual([
      'mp4',
      'mkv',
      'webm',
      'mp3',
    ]);
    expect(getOutputFormat('mp4').kind).toBe('video');
    expect(getOutputFormat('webm').videoCodec).toBe('VP9');
    expect(getOutputFormat('webm').audioCodec).toBe('Opus');
    expect(getOutputFormat('mp3').kind).toBe('audio');
    expect(getOutputFormat('mp3').videoCodec).toBeNull();
    expect(getFormatExtension('webm')).toBe('webm');
    expect(getFormatExtension('mp3')).toBe('mp3');

    logger.info('PASS 格式矩阵与扩展名正确');
  });

  it('解析真实 ffmpeg -encoders 输出，并生成可用/缺失原因', () => {
    logger.info('START 解析编码器列表和能力矩阵');

    const encoders = parseEncoderList(sampleEncoders);
    expect(encoders['libx264']).toBe(true);
    expect(encoders['libvpx-vp9']).toBe(true);
    expect(encoders.aac).toBe(true);
    expect(encoders.libopus).toBe(true);
    expect(encoders.libmp3lame).toBe(true);

    const capabilities = buildConversionCapabilities(encoders, {
      checkedAt: 123,
      ffmpegVersion: '8.0.1',
    });
    expect(getFormatCapability(capabilities, 'mp4').available).toBe(true);
    expect(getFormatCapability(capabilities, 'webm').available).toBe(true);
    expect(getFormatCapability(capabilities, 'mp3').available).toBe(true);

    const missing = buildConversionCapabilities(
      { ...ALL_ENCODERS_AVAILABLE, libopus: false },
      { checkedAt: 0, ffmpegVersion: '8.0.1' },
    );
    const webm = getFormatCapability(missing, 'webm');
    expect(webm.available).toBe(false);
    expect(webm.missingEncoders).toContain('libopus');
    expect(webm.reason).toContain('libopus');

    logger.info('PASS 编码器解析和缺失原因正确');
  });
});

// ============================================================================
// 参数构造
// ============================================================================

describe('阶段 6 / WebM 与 MP3 参数', () => {
  it('WebM 使用 VP9、Opus、CRF 和 WebM 专属参数', () => {
    logger.info('START 构造 WebM 参数');

    const args = buildConversionArgs({
      inputPath: 'C:\\媒体 样本\\测试 视频.mp4',
      outputPath: 'C:\\输出 目录\\测试 视频_converted.webm',
      format: 'webm',
      qualityPreset: 'compatible',
      hasAudio: true,
    });

    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx-vp9');
    expect(args[args.indexOf('-crf') + 1]).toBe('32');
    expect(args[args.indexOf('-b:v') + 1]).toBe('0');
    expect(args[args.indexOf('-c:a') + 1]).toBe('libopus');
    expect(args[args.indexOf('-b:a') + 1]).toBe('192k');
    expect(args).toContain('-row-mt');
    expect(args).not.toContain('-movflags');
    expect(args).toContain('-progress');

    logger.info('PASS WebM 参数包含 VP9/Opus');
  });

  it('WebM 无音轨输入使用 -an，不出现音频编码器', () => {
    logger.info('START 构造无音轨 WebM 参数');

    const args = buildConversionArgs({
      inputPath: 'C:\\媒体 样本\\无音轨.mp4',
      outputPath: 'C:\\输出 目录\\无音轨_converted.webm',
      format: 'webm',
      qualityPreset: 'compact',
      hasAudio: false,
    });

    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
    expect(args).not.toContain('libopus');
    expect(args[args.indexOf('-crf') + 1]).toBe('36');

    logger.info('PASS 无音轨 WebM 使用 -an');
  });

  it('MP3 只导出音频，不构造视频编码参数', () => {
    logger.info('START 构造 MP3 参数');

    const args = buildConversionArgs({
      inputPath: 'C:\\媒体 样本\\测试 视频.mp4',
      outputPath: 'C:\\输出 目录\\测试 视频_converted.mp3',
      format: 'mp3',
      qualityPreset: 'quality',
      hasAudio: true,
    });

    expect(args).toContain('-vn');
    expect(args).not.toContain('-c:v');
    expect(args).not.toContain('-crf');
    expect(args[args.indexOf('-c:a') + 1]).toBe('libmp3lame');
    expect(args[args.indexOf('-b:a') + 1]).toBe('256k');

    logger.info('PASS MP3 参数只包含音频编码');
  });

  it('无音轨输入导出 MP3 时明确拒绝', () => {
    logger.info('START 检查 MP3 无音轨拒绝');

    expect(() =>
      buildConversionArgs({
        inputPath: 'C:\\媒体 样本\\无音轨.mp4',
        outputPath: 'C:\\输出 目录\\无音轨_converted.mp3',
        format: 'mp3',
        qualityPreset: 'compatible',
        hasAudio: false,
      }),
    ).toThrow(/音轨|MP3/);

    logger.info('PASS MP3 无音轨被拒绝');
  });

  it('输出命名对 WebM/MP3 使用 profile 扩展名', () => {
    expect(buildOutputPath('C:\\输出 目录', '测试 视频.mp4', 'webm')).toBe(
      'C:\\输出 目录\\测试 视频_converted.webm',
    );
    expect(buildOutputPath('C:\\输出 目录', '测试 视频.mp4', 'mp3')).toBe(
      'C:\\输出 目录\\测试 视频_converted.mp3',
    );
  });
});

// ============================================================================
// 队列层拒绝
// ============================================================================

describe('阶段 6 / 队列音频校验', () => {
  it('MP3 任务在入队阶段拒绝无音轨源，不启动 FFmpeg', async () => {
    logger.info('START 入队无音轨 MP3');

    const runJob = vi.fn();
    const queue = new ConversionQueue({
      runJob,
      validateSource: async (sourcePath) => ({
        ok: true,
        path: sourcePath,
        hasAudio: false,
      }),
      validateOutputDirectory: async () => ({
        ok: true,
        path: 'C:\\输出 目录',
      }),
      findOutputPath: async (directory, fileName, format) =>
        buildOutputPath(directory, fileName, format),
      pathExists: async () => false,
      now: () => 0,
      generateId: () => 'job-mp3-no-audio',
    });

    const settings: ConversionSettingsValue = {
      format: 'mp3',
      qualityPreset: 'compatible',
      outputDirectory: 'C:\\输出 目录',
      advanced: { ...DEFAULT_ADVANCED_SETTINGS },
    };
    const [job] = await queue.enqueue(['C:\\媒体 样本\\无音轨.mp4'], settings);

    expect(job.status).toBe('failed');
    expect(job.error).toContain('音轨');
    expect(runJob).not.toHaveBeenCalled();

    logger.info('PASS 无音轨 MP3 未启动转换');
  });
});

// ============================================================================
// 输出校验
// ============================================================================

describe('阶段 6 / 输出 profile 校验', () => {
  const webmSettings: ConversionSettingsValue = {
    format: 'webm',
    qualityPreset: 'compatible',
    outputDirectory: 'C:\\输出 目录',
    advanced: { ...DEFAULT_ADVANCED_SETTINGS },
  };
  const mp3Settings: ConversionSettingsValue = {
    format: 'mp3',
    qualityPreset: 'compatible',
    outputDirectory: 'C:\\输出 目录',
    advanced: { ...DEFAULT_ADVANCED_SETTINGS },
  };

  it('接受真实的 WebM VP9/Opus 输出', () => {
    expect(() =>
      assertOutputMatchesProfile(
        {
          durationMs: 2000,
          containerFormat: 'WebM',
          videoCodec: 'VP9',
          audioCodec: 'Opus',
          hasVideo: true,
          hasAudio: true,
          width: 320,
          height: 240,
        },
        webmSettings,
        true,
      ),
    ).not.toThrow();
  });

  it('拒绝 MP3 中的视频轨道和缺失音轨的视频输出', () => {
    expect(() =>
      assertOutputMatchesProfile(
        {
          durationMs: 2000,
          containerFormat: 'MP3',
          videoCodec: null,
          audioCodec: 'MP3',
          hasVideo: true,
          hasAudio: true,
          width: null,
          height: null,
        },
        mp3Settings,
        true,
      ),
    ).toThrow('视频轨道');

    expect(() =>
      assertOutputMatchesProfile(
        {
          durationMs: 2000,
          containerFormat: 'MP4',
          videoCodec: 'H.264',
          audioCodec: null,
          hasVideo: true,
          hasAudio: false,
          width: 320,
          height: 240,
        },
        {
          format: 'mp4',
          qualityPreset: 'compatible',
          outputDirectory: 'C:\\输出 目录',
          advanced: { ...DEFAULT_ADVANCED_SETTINGS },
        },
        true,
      ),
    ).toThrow('缺少源视频中的音频轨道');

    expect(() =>
      assertOutputMatchesProfile(
        {
          durationMs: 2000,
          containerFormat: 'MP4',
          videoCodec: 'VP9',
          audioCodec: 'Opus',
          hasVideo: true,
          hasAudio: true,
          width: 320,
          height: 240,
        },
        webmSettings,
        true,
      ),
    ).toThrow('输出容器');
  });
});

// ============================================================================
// UI 能力展示
// ============================================================================

describe('阶段 6 / 真实编码器与格式输出', () => {
  it('真实读取 ffmpeg -encoders，WebM/MP3 编码器均可用', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegService) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    logger.info('START 读取真实编码器能力');
    const service = new FfmpegCapabilityService({
      getFfmpegStatus: () => ffmpegService!.getStatus(),
      now: () => 1,
    });
    const capabilities = await service.getCapabilities();

    expect(capabilities.error).toBeNull();
    expect(capabilities.ffmpegVersion).toBe(ffmpegStatus?.version);
    expect(capabilities.encoders['libx264']).toBe(true);
    expect(capabilities.encoders.aac).toBe(true);
    expect(capabilities.encoders['libvpx-vp9']).toBe(true);
    expect(capabilities.encoders.libopus).toBe(true);
    expect(capabilities.encoders.libmp3lame).toBe(true);
    expect(getFormatCapability(capabilities, 'webm').available).toBe(true);
    expect(getFormatCapability(capabilities, 'mp3').available).toBe(true);

    logger.info('PASS 真实编码器能力可用');
  });

  it('真实转换为 WebM，ffprobe 确认 VP9/Opus', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegService || !ffmpegStatus?.ffprobePath) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    logger.info('START 真实 WebM 转换');
    const outputDirectory = createOutputDirectory('WebM 输出');
    const queue = createConversionQueue({ ffmpeg: ffmpegService });
    await queue.enqueue([fixtures.withAudio], {
      format: 'webm',
      qualityPreset: 'compatible',
      outputDirectory,
      advanced: { ...DEFAULT_ADVANCED_SETTINGS },
    });
    await queue.waitForIdle();

    const finished = queue.getJobs()[0];
    logger.info('STEP 检查 WebM 任务结果', {
      status: finished.status,
      error: finished.error,
      outputPath: finished.outputPath,
    });
    expect(finished.status).toBe('completed');
    expect(finished.progress).toBe(100);
    expect(finished.outputPath.endsWith('.webm')).toBe(true);
    expect(existsSync(finished.outputPath)).toBe(true);

    const metadata = await probeOutputFile(
      ffmpegStatus.ffprobePath,
      finished.outputPath,
    );
    expect(metadata.videoCodec).toBe('VP9');
    expect(metadata.audioCodec).toBe('Opus');
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);

    logger.info('PASS WebM 输出为真实 VP9/Opus');
  });

  it('真实转换为 MP3，ffprobe 确认只有音频', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegService || !ffmpegStatus?.ffprobePath) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    logger.info('START 真实 MP3 转换');
    const outputDirectory = createOutputDirectory('MP3 输出');
    const queue = createConversionQueue({ ffmpeg: ffmpegService });
    await queue.enqueue([fixtures.withAudio], {
      format: 'mp3',
      qualityPreset: 'quality',
      outputDirectory,
      advanced: { ...DEFAULT_ADVANCED_SETTINGS },
    });
    await queue.waitForIdle();

    const finished = queue.getJobs()[0];
    logger.info('STEP 检查 MP3 任务结果', {
      status: finished.status,
      error: finished.error,
      outputPath: finished.outputPath,
    });
    expect(finished.status).toBe('completed');
    expect(finished.outputPath.endsWith('.mp3')).toBe(true);
    expect(existsSync(finished.outputPath)).toBe(true);

    const metadata = await probeOutputFile(
      ffmpegStatus.ffprobePath,
      finished.outputPath,
    );
    expect(metadata.hasAudio).toBe(true);
    expect(metadata.hasVideo).toBe(false);
    expect(metadata.audioCodec).toBe('MP3');
    expect(metadata.videoCodec).toBeNull();

    logger.info('PASS MP3 输出只有真实音频');
  });

  it('无音轨视频导出 MP3 在入队阶段被拒绝', async ({ skip }) => {
    if (!ffmpegAvailable || !ffmpegService) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    logger.info('START 真实无音轨 MP3 拒绝');
    const outputDirectory = createOutputDirectory('MP3 拒绝输出');
    const queue = createConversionQueue({ ffmpeg: ffmpegService });
    const [job] = await queue.enqueue([fixtures.noAudio], {
      format: 'mp3',
      qualityPreset: 'compatible',
      outputDirectory,
      advanced: { ...DEFAULT_ADVANCED_SETTINGS },
    });
    await queue.waitForIdle();

    expect(job.status).toBe('failed');
    expect(job.error).toContain('音轨');
    expect(queue.getJobs()[0].outputPath).toBe('');

    logger.info('PASS 无音轨 MP3 被拒绝，未生成输出');
  });
});

describe('阶段 6 / 格式选择 UI', () => {
  it('可用格式显示容器和编码说明，选择 WebM 触发真实格式变更', () => {
    logger.info('START 渲染可用格式 UI');

    const handlers = renderSettings();
    const formatSelect = screen.getByLabelText('输出格式');

    expect(screen.getByRole('option', { name: /WebM/ })).not.toBeDisabled();
    expect(screen.getByRole('option', { name: /MP3/ })).not.toBeDisabled();
    expect(screen.getByText(/H\.264.*AAC/)).toBeInTheDocument();

    fireEvent.change(formatSelect, { target: { value: 'webm' } });
    expect(handlers.onFormatChange).toHaveBeenCalledWith('webm');

    logger.info('PASS 格式说明和变更回调正确');
  });

  it('选中 WebM 时显示 VP9 + Opus 编码摘要', () => {
    logger.info('START 渲染 WebM 选中态');

    renderSettings({ format: 'webm' });

    expect(screen.getByText(/VP9.*Opus/)).toBeInTheDocument();
    expect(screen.getByText(/开放网络格式/)).toBeInTheDocument();

    logger.info('PASS WebM 编码摘要正确');
  });

  it('编码器缺失时禁用格式并展示真实缺失原因', () => {
    logger.info('START 渲染缺少 VP9/Opus 的 UI');

    renderSettings({
      format: 'webm',
      capabilities: missingWebmCapabilities,
    });

    expect(screen.getByRole('option', { name: /WebM/ })).toBeDisabled();
    expect(screen.getByText(/libvpx-vp9/)).toBeInTheDocument();
    expect(screen.getByText(/libopus/)).toBeInTheDocument();

    logger.info('PASS 缺失编码器没有显示为可用');
  });

  it('能力检测失败时提供重新检测入口', () => {
    logger.info('START 渲染能力检测失败 UI');

    const handlers = renderSettings({
      capabilitiesError: 'ffmpeg -encoders 执行失败',
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      '编码器检测失败：ffmpeg -encoders 执行失败',
    );
    fireEvent.click(screen.getByRole('button', { name: '重新检测编码器' }));
    expect(handlers.onRefreshCapabilities).toHaveBeenCalledOnce();

    logger.info('PASS 重新检测按钮已接线');
  });

  it('选择 MP3 时隐藏视频语义，显示音频质量和无音轨排除说明', () => {
    logger.info('START 渲染 MP3 音频-only UI');

    renderSettings({
      format: 'mp3',
      audioOnlyExcludedCount: 2,
    });

    expect(screen.getByText(/仅导出音频/)).toBeInTheDocument();
    expect(screen.getByLabelText('音频质量')).toBeInTheDocument();
    expect(screen.getByText('音频 192 kbps')).toBeInTheDocument();
    expect(screen.queryByText(/VP9 CRF/)).not.toBeInTheDocument();
    expect(screen.getByText(/已排除 2 个无音轨/)).toBeInTheDocument();

    logger.info('PASS MP3 UI 明确音频-only');
  });
});
