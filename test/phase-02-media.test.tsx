/**
 * 阶段 2 测试：媒体导入、FFprobe 元数据、FFmpeg 缩略图与环境状态。
 *
 * 组织方式：
 * - 阶段 2 只使用这一个测试文件，内部按流程分组，不再拆成一堆小文件。
 * - 纯函数解析、路径校验、FFmpeg 路径解析、状态检测、真实 FFmpeg/FFprobe 集成、
 *   MediaService 降级逻辑和导入 UI 都在这里覆盖。
 *
 * 对应需求：
 * - 系统文件选择器多选视频。
 * - ffprobe 读取时长、分辨率、帧率、容器、视频/音频编码、文件大小。
 * - ffmpeg 提取缩略图；失败只显示占位图，不阻塞文件。
 * - 中文/空格路径、未知帧率、无音轨、短视频、坏文件、FFmpeg 缺失。
 * - 子进程只使用 spawn 参数数组，不经过 shell。
 *
 * 真实集成测试会调用本机 ffmpeg/ffprobe 生成并读取样本；如果本机没有 FFmpeg，
 * 相应用例会通过 test context 标记为 skip，并在日志中写明原因，不会伪装成通过。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import App from '../src/App';
import { createTestLogger } from './helpers/test-logger';
import { DESKTOP_API_KEYS, IPC_CHANNELS, type AppInfo, type DesktopAPI } from '../shared/ipc';
import {
  formatDuration,
  formatFileSize,
  formatFrameRate,
  formatResolution,
} from '../shared/media-format';
import type { FfmpegStatus, MediaItem, MediaMetadata } from '../shared/media';
import {
  buildFfprobeArgs,
  MediaProbeError,
  parseFfprobeJson,
  parseFrameRate,
  probeMedia,
  validateVideoPath,
} from '../electron/main/services/media/probe';
import { resolveFfmpegPaths } from '../electron/main/services/ffmpeg/resolver';
import {
  FfmpegService,
  parseFfmpegVersion,
} from '../electron/main/services/ffmpeg/status';
import {
  runProcess,
  type RunProcess,
  type RunProcessOptions,
} from '../electron/main/services/ffmpeg/process';
import {
  buildThumbnailArgs,
  extractThumbnail,
} from '../electron/main/services/media/thumbnail';
import {
  createMediaService,
  MediaService,
} from '../electron/main/services/media/media-service';
import { createDesktopApi } from '../electron/preload/api';

const logger = createTestLogger('phase-02');

let fixtureRoot = '';
let ffmpegStatus: FfmpegStatus | null = null;
let ffmpegAvailable = false;
let mediaService: MediaService | null = null;

const fixtures = {
  chinese: '',
  noAudio: '',
  corrupt: '',
  validationVideo: '',
  validationText: '',
  validationDirectory: '',
};

/** 生成一个带音轨的 2 秒测试视频，用于验证元数据与缩略图。 */
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
      'testsrc=size=320x240:rate=30:duration=2',
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

/** 生成一个 1 秒、无音轨的视频，用于验证“无音轨是合法情况”。 */
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
  fixtureRoot = mkdtempSync(join(tmpdir(), 'frameforge-phase02-'));

  // 路径校验不依赖 FFmpeg，先准备真实文件、目录和中文/空格路径。
  const validationDirectory = join(fixtureRoot, '校验 目录');
  mkdirSync(validationDirectory, { recursive: true });
  fixtures.validationVideo = join(validationDirectory, '中文 视频.MP4');
  fixtures.validationText = join(validationDirectory, '说明.txt');
  fixtures.validationDirectory = join(validationDirectory, '子目录');
  writeFileSync(fixtures.validationVideo, 'not real media, only for path validation');
  writeFileSync(fixtures.validationText, 'text');
  mkdirSync(fixtures.validationDirectory);

  const service = new FfmpegService({
    resolvePaths: () =>
      resolveFfmpegPaths({
        isPackaged: false,
        resourcesPath: '',
        appPath: process.cwd(),
        env: process.env,
        platform: process.platform,
      }),
  });

  ffmpegStatus = await service.getStatus();
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
    logger.warn('真实 FFmpeg 不可用，阶段 2 的 FFmpeg/FFprobe 集成用例将标记为 skip');
    return;
  }

  mediaService = createMediaService(service);

  const mediaDirectory = join(fixtureRoot, '媒体 样本');
  mkdirSync(mediaDirectory, { recursive: true });
  fixtures.chinese = join(mediaDirectory, '测试 视频.mp4');
  fixtures.noAudio = join(fixtureRoot, '无音轨.mp4');
  fixtures.corrupt = join(fixtureRoot, '损坏 文件.mp4');

  await generateVideoWithAudio(fixtures.chinese);
  await generateVideoWithoutAudio(fixtures.noAudio);
  writeFileSync(fixtures.corrupt, 'this is not a video file');
}, 120000);

afterAll(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

// ============================================================================
// 纯函数：格式化与解析
// ============================================================================

describe('阶段 2 / 格式化与 ffprobe 解析', () => {
  it('把时长、帧率、文件大小和分辨率格式化成稳定文案', () => {
    logger.info('STEP 校验时长格式');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(5000)).toBe('00:05');
    expect(formatDuration(65000)).toBe('01:05');
    expect(formatDuration(3661000)).toBe('1:01:01');
    expect(formatDuration(null)).toBe('未知');

    logger.info('STEP 校验帧率格式');
    expect(formatFrameRate(30000 / 1001)).toBe('29.97 fps');
    expect(formatFrameRate(30)).toBe('30 fps');
    expect(formatFrameRate(23.976)).toBe('23.98 fps');
    expect(formatFrameRate(null)).toBe('未知');
    expect(formatFrameRate(0)).toBe('未知');

    logger.info('STEP 校验文件大小格式');
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2 GB');

    logger.info('STEP 校验分辨率格式');
    expect(formatResolution(1920, 1080)).toBe('1920×1080');
    expect(formatResolution(null, 1080)).toBe('未知');
  });

  it('安全解析 ffprobe 的分数帧率，0/0 和 N/A 不产生 NaN', () => {
    logger.info('STEP 解析常见分数帧率');
    expect(parseFrameRate('30000/1001')).toBe(29.97);
    expect(parseFrameRate('24000/1001')).toBe(23.976);
    expect(parseFrameRate('25/1')).toBe(25);

    logger.info('STEP 解析非法帧率');
    expect(parseFrameRate('0/0')).toBeNull();
    expect(parseFrameRate('N/A')).toBeNull();
    expect(parseFrameRate(undefined)).toBeNull();
    expect(parseFrameRate('abc')).toBeNull();
  });

  it('解析典型 MP4：视频流、音轨、分数帧率和容器映射', () => {
    const json = JSON.stringify({
      streams: [
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '30000/1001',
          avg_frame_rate: '30000/1001',
          duration: '2.002000',
          disposition: { attached_pic: 0 },
        },
        { index: 1, codec_type: 'audio', codec_name: 'aac' },
      ],
      format: {
        filename: 'C:\\videos\\sample.mp4',
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        duration: '2.002000',
        size: '12345',
      },
    });

    logger.info('STEP 解析 MP4 JSON');
    const metadata = parseFfprobeJson(json, 'C:\\videos\\样例 视频.mp4', 12345);

    logger.info('STEP 断言元数据映射', { metadata });
    expect(metadata).toMatchObject({
      path: 'C:\\videos\\样例 视频.mp4',
      fileName: '样例 视频.mp4',
      fileSizeBytes: 12345,
      durationMs: 2002,
      width: 1920,
      height: 1080,
      frameRate: 29.97,
      containerFormat: 'MP4',
      videoCodec: 'H.264',
      audioCodec: 'AAC',
      hasAudio: true,
    });
  });

  it('无音轨、未知帧率、缺失时长时返回可读空值', () => {
    const json = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'mpeg4',
          width: 320,
          height: 240,
          r_frame_rate: '0/0',
          avg_frame_rate: 'N/A',
        },
      ],
      format: {
        format_name: 'matroska,webm',
        size: '2048',
      },
    });

    logger.info('STEP 解析无音轨、未知帧率、缺失时长的 MKV');
    const metadata = parseFfprobeJson(json, 'C:\\videos\\sample.mkv', 2048);

    expect(metadata.hasAudio).toBe(false);
    expect(metadata.audioCodec).toBeNull();
    expect(metadata.frameRate).toBeNull();
    expect(metadata.durationMs).toBeNull();
    expect(metadata.containerFormat).toBe('MKV');
    expect(metadata.videoCodec).toBe('MPEG-4');
  });

  it('没有视频流或 JSON 损坏时抛出可读错误', () => {
    logger.info('STEP 解析只有音频流的文件');
    expect(() =>
      parseFfprobeJson(
        JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'mp3' }] }),
        'C:\\videos\\audio.mp3',
        100,
      ),
    ).toThrow(MediaProbeError);

    expect(() =>
      parseFfprobeJson(
        JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'mp3' }] }),
        'C:\\videos\\audio.mp3',
        100,
      ),
    ).toThrow(/没有视频轨道/);

    logger.info('STEP 解析损坏的 JSON');
    expect(() => parseFfprobeJson('not json', 'C:\\videos\\bad.mp4', 10)).toThrow(
      MediaProbeError,
    );
    expect(() => parseFfprobeJson('not json', 'C:\\videos\\bad.mp4', 10)).toThrow(
      /无法解析/,
    );
  });
});

// ============================================================================
// 路径校验
// ============================================================================

describe('阶段 2 / 视频路径校验', () => {
  it('接受中文/空格绝对路径，拒绝错误扩展名、缺失文件和目录', async () => {
    logger.info('STEP 校验中文/空格路径和大写扩展名');
    const accepted = await validateVideoPath(fixtures.validationVideo);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.path).toBe(fixtures.validationVideo);
      expect(accepted.fileSizeBytes).toBeGreaterThan(0);
    }

    logger.info('STEP 拒绝相对路径');
    await expect(validateVideoPath('relative.mp4')).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/绝对路径/),
    });

    logger.info('STEP 拒绝非视频扩展名');
    await expect(validateVideoPath(fixtures.validationText)).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/不支持/),
    });

    logger.info('STEP 拒绝不存在的文件');
    await expect(
      validateVideoPath(join(fixtureRoot, '不存在 视频.mp4')),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/不存在/),
    });

    logger.info('STEP 拒绝目录');
    await expect(validateVideoPath(fixtures.validationDirectory)).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/不是文件|目录/),
    });
  });
});

// ============================================================================
// FFmpeg 路径解析与状态检测
// ============================================================================

/** 构造一个只“存在”指定路径的 access 函数。 */
function createAccess(existing: string[]) {
  const set = new Set(existing);
  return async (path: string) => set.has(path);
}

describe('阶段 2 / FFmpeg 路径与状态', () => {
  it('按环境变量、随包目录、系统 PATH 的顺序解析 ffmpeg/ffprobe', async () => {
    logger.info('STEP 环境变量优先于随包目录');
    const envDir = join('C:\\tools', 'ffmpeg');
    const bundledDir = join('C:\\app', 'resources', 'ffmpeg');
    const envPaths = [join(envDir, 'ffmpeg.exe'), join(envDir, 'ffprobe.exe')];
    const bundledPaths = [
      join(bundledDir, 'ffmpeg.exe'),
      join(bundledDir, 'ffprobe.exe'),
    ];
    const envResult = await resolveFfmpegPaths({
      isPackaged: true,
      resourcesPath: join('C:\\app', 'resources'),
      appPath: 'C:\\app',
      platform: 'win32',
      env: { FRAMEFORGE_FFMPEG_DIR: envDir, PATH: '' },
      access: createAccess([...envPaths, ...bundledPaths]),
    });

    expect(envResult).toMatchObject({
      source: 'environment',
      directory: envDir,
      ffmpegPath: envPaths[0],
      ffprobePath: envPaths[1],
    });

    logger.info('STEP 随包目录在打包模式生效');
    const bundledResult = await resolveFfmpegPaths({
      isPackaged: true,
      resourcesPath: join('C:\\app', 'resources'),
      appPath: 'C:\\app',
      platform: 'win32',
      env: { PATH: '' },
      access: createAccess(bundledPaths),
    });

    expect(bundledResult).toMatchObject({
      source: 'bundled',
      directory: bundledDir,
      ffmpegPath: bundledPaths[0],
      ffprobePath: bundledPaths[1],
    });

    logger.info('STEP 没找到随包目录时回退系统 PATH');
    const systemDir = join('C:\\Program Files', 'ffmpeg', 'bin');
    const systemPaths = [
      join(systemDir, 'ffmpeg.exe'),
      join(systemDir, 'ffprobe.exe'),
    ];
    const systemResult = await resolveFfmpegPaths({
      isPackaged: false,
      resourcesPath: '',
      appPath: 'C:\\app',
      platform: 'win32',
      env: {
        PATH: `C:\\Windows;${systemDir}`,
      },
      access: createAccess(systemPaths),
    });

    expect(systemResult).toMatchObject({
      source: 'system',
      directory: systemDir,
      ffmpegPath: systemPaths[0],
      ffprobePath: systemPaths[1],
    });
  });

  it('只有 ffmpeg 而没有 ffprobe 时不算可用', async () => {
    logger.info('STEP 只提供 ffmpeg.exe');
    const directory = join('C:\\tools', 'ffmpeg');
    const result = await resolveFfmpegPaths({
      isPackaged: false,
      resourcesPath: '',
      appPath: 'C:\\app',
      platform: 'win32',
      env: { FRAMEFORGE_FFMPEG_DIR: directory, PATH: '' },
      access: createAccess([join(directory, 'ffmpeg.exe')]),
    });

    expect(result).toBeNull();
  });

  it('解析版本号、缓存状态，并支持 refresh 重新检测', async () => {
    logger.info('STEP 构造两个版本命令都成功的假进程');
    const fakePaths = {
      ffmpegPath: join('C:\\tools', 'ffmpeg.exe'),
      ffprobePath: join('C:\\tools', 'ffprobe.exe'),
      directory: 'C:\\tools',
      source: 'system' as const,
    };
    const fakeRunProcess = vi.fn(async ({ executable }: RunProcessOptions) => ({
      stdout: executable.includes('ffprobe')
        ? 'ffprobe version 8.0.1-full_build-www.gyan.dev Copyright'
        : 'ffmpeg version 8.0.1-full_build-www.gyan.dev Copyright',
      stderr: '',
      exitCode: 0,
    })) as unknown as RunProcess;

    const service = new FfmpegService({
      resolvePaths: async () => fakePaths,
      runProcess: fakeRunProcess,
    });

    const [status, concurrentStatus] = await Promise.all([
      service.getStatus(),
      service.getStatus(),
    ]);
    expect(concurrentStatus).toBe(status);
    expect(status).toMatchObject({
      available: true,
      version: '8.0.1',
      ffprobeVersion: '8.0.1',
      source: 'system',
      ffmpegPath: fakePaths.ffmpegPath,
      ffprobePath: fakePaths.ffprobePath,
      error: null,
    });
    expect(parseFfmpegVersion('ffmpeg version 8.0.1-full_build Copyright')).toBe('8.0.1');
    expect(fakeRunProcess).toHaveBeenCalledTimes(2);

    logger.info('STEP 再次读取应命中缓存');
    await service.getStatus();
    expect(fakeRunProcess).toHaveBeenCalledTimes(2);

    logger.info('STEP refresh 应重新执行版本检查');
    await service.getStatus(true);
    expect(fakeRunProcess).toHaveBeenCalledTimes(4);
  });

  it('FFmpeg 缺失或执行失败时返回可操作的错误', async () => {
    logger.info('STEP 模拟完全找不到 ffmpeg/ffprobe');
    const missingService = new FfmpegService({
      resolvePaths: async () => null,
    });
    const missingStatus = await missingService.getStatus();

    expect(missingStatus.available).toBe(false);
    expect(missingStatus.error).toMatch(/未找到 FFmpeg/);
    expect(missingStatus.ffmpegPath).toBeNull();

    logger.info('STEP 模拟版本检查进程失败');
    const failingService = new FfmpegService({
      resolvePaths: async () => ({
        ffmpegPath: 'C:\\tools\\ffmpeg.exe',
        ffprobePath: 'C:\\tools\\ffprobe.exe',
        directory: 'C:\\tools',
        source: 'system',
      }),
      runProcess: (async () => {
        throw new Error('spawn ENOENT');
      }) as RunProcess,
    });
    const failingStatus = await failingService.getStatus();

    expect(failingStatus.available).toBe(false);
    expect(failingStatus.error).toMatch(/FFmpeg|ffmpeg|ENOENT/);
  });

  it('真实环境能检测到 FFmpeg 版本', async ({ skip }) => {
    if (!ffmpegAvailable) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    logger.info('STEP 断言真实 FFmpeg 状态', { status: ffmpegStatus });
    expect(ffmpegStatus?.available).toBe(true);
    expect(ffmpegStatus?.version).toMatch(/^\d+\.\d+/);
    expect(ffmpegStatus?.ffprobeVersion).toMatch(/^\d+\.\d+/);
    expect(ffmpegStatus?.ffmpegPath).toMatch(/ffmpeg(\.exe)?$/);
    expect(ffmpegStatus?.ffprobePath).toMatch(/ffprobe(\.exe)?$/);
  });
});

// ============================================================================
// 缩略图与真实 ffprobe
// ============================================================================

describe('阶段 2 / 缩略图与真实媒体探测', () => {
  it('缩略图参数使用参数数组、固定 16:9 缩放，短视频不 seek', () => {
    const input = 'C:\\媒体 样本\\测试 视频.mp4';
    const output = 'C:\\temp\\thumb.jpg';

    logger.info('STEP 生成长视频缩略图参数');
    const longArgs = buildThumbnailArgs(input, output, 5000);

    expect(longArgs).toContain(input);
    expect(longArgs).toContain(output);
    expect(longArgs.indexOf('-ss')).toBeLessThan(longArgs.indexOf('-i'));
    expect(longArgs[longArgs.indexOf('-ss') + 1]).toBe('1');
    expect(longArgs[longArgs.indexOf('-frames:v') + 1]).toBe('1');
    expect(longArgs).toContain(
      'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:color=black',
    );

    logger.info('STEP 短视频不应使用 -ss，直接从第 0 帧抽取');
    const shortArgs = buildThumbnailArgs(input, output, 1000);
    expect(shortArgs).not.toContain('-ss');
  });

  it('真实 FFmpeg 能为中文路径视频生成 320×180 JPEG 缩略图', async ({ skip }) => {
    if (!ffmpegAvailable) {
      skip('本机没有可用的 ffmpeg');
      return;
    }

    logger.info('STEP 调用真实 FFmpeg 抽取缩略图', { input: fixtures.chinese });
    const thumbnail = await extractThumbnail(ffmpegStatus!.ffmpegPath!, fixtures.chinese, {
      durationMs: 2000,
      tempDir: join(fixtureRoot, 'thumbs'),
    });

    expect(thumbnail.width).toBe(320);
    expect(thumbnail.height).toBe(180);
    expect(thumbnail.dataUrl).toMatch(/^data:image\/jpeg;base64,/);

    const bytes = Buffer.from(thumbnail.dataUrl.split(',')[1], 'base64');
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it('真实 ffprobe 读取中文/空格路径的元数据', async ({ skip }) => {
    if (!ffmpegAvailable) {
      skip('本机没有可用的 ffprobe');
      return;
    }

    logger.info('STEP 读取中文/空格路径视频');
    const metadata = await probeMedia(ffmpegStatus!.ffprobePath!, fixtures.chinese);

    logger.info('STEP 断言真实元数据', { metadata });
    expect(metadata.fileName).toBe('测试 视频.mp4');
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
    expect(metadata.frameRate).toBe(30);
    expect(metadata.videoCodec).toBe('MPEG-4');
    expect(metadata.audioCodec).toBe('AAC');
    expect(metadata.hasAudio).toBe(true);
    expect(metadata.containerFormat).toBe('MP4');
    expect(metadata.durationMs).toBeGreaterThanOrEqual(1800);
    expect(metadata.durationMs).toBeLessThanOrEqual(2300);
    expect(metadata.fileSizeBytes).toBeGreaterThan(0);
  });

  it('真实 ffprobe 接受无音轨视频', async ({ skip }) => {
    if (!ffmpegAvailable) {
      skip('本机没有可用的 ffprobe');
      return;
    }

    logger.info('STEP 读取无音轨视频');
    const metadata = await probeMedia(ffmpegStatus!.ffprobePath!, fixtures.noAudio);

    expect(metadata.hasAudio).toBe(false);
    expect(metadata.audioCodec).toBeNull();
    expect(metadata.frameRate).toBe(25);
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
  });

  it('真实 ffprobe 对损坏文件返回可读错误', async ({ skip }) => {
    if (!ffmpegAvailable) {
      skip('本机没有可用的 ffprobe');
      return;
    }

    logger.info('STEP 读取伪造的损坏 MP4');
    await expect(
      probeMedia(ffmpegStatus!.ffprobePath!, fixtures.corrupt),
    ).rejects.toThrow(/无法读取视频|moov|Invalid|损坏/);
  });

  it('构造 ffprobe 参数时不拼接 shell 字符串', () => {
    const args = buildFfprobeArgs('C:\\媒体 样本\\测试 视频.mp4');

    expect(args).toContain('C:\\媒体 样本\\测试 视频.mp4');
    expect(args).toContain('-print_format');
    expect(args).toContain('json');
    expect(args).toContain('-show_format');
    expect(args).toContain('-show_streams');
  });
});

// ============================================================================
// MediaService：真实导入与失败降级
// ============================================================================

describe('阶段 2 / 媒体导入服务', () => {
  it('一次导入正常视频、无音轨视频和损坏文件', async ({ skip }) => {
    if (!ffmpegAvailable || !mediaService) {
      skip('本机没有可用的 ffmpeg/ffprobe');
      return;
    }

    logger.info('STEP 调用真实 MediaService 导入三个文件');
    const items = await mediaService.importFiles([
      fixtures.chinese,
      fixtures.noAudio,
      fixtures.corrupt,
    ]);

    expect(items).toHaveLength(3);

    logger.info('STEP 断言正常视频');
    expect(items[0].error).toBeNull();
    expect(items[0].metadata?.fileName).toBe('测试 视频.mp4');
    expect(items[0].thumbnailDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(items[0].thumbnailError).toBeNull();

    logger.info('STEP 断言无音轨视频仍有缩略图');
    expect(items[1].error).toBeNull();
    expect(items[1].metadata?.hasAudio).toBe(false);
    expect(items[1].thumbnailDataUrl).toMatch(/^data:image\/jpeg;base64,/);

    logger.info('STEP 断言损坏文件只影响自己');
    expect(items[2].error).toMatch(/无法读取视频|moov|Invalid|损坏/);
    expect(items[2].metadata).toBeNull();
    expect(items[2].thumbnailDataUrl).toBeNull();
  });

  it('缩略图失败只降级为占位图，不把文件标记为不可用', async () => {
    const metadata: MediaMetadata = {
      path: 'C:\\videos\\sample.mp4',
      fileName: 'sample.mp4',
      durationMs: 5000,
      width: 1920,
      height: 1080,
      frameRate: 30,
      containerFormat: 'MP4',
      videoCodec: 'H.264',
      audioCodec: 'AAC',
      hasAudio: true,
      fileSizeBytes: 1024,
    };

    const service = new MediaService({
      probe: async () => metadata,
      extractThumbnail: async () => {
        throw new Error('缩略图生成失败');
      },
    });

    logger.info('STEP 让缩略图服务抛错');
    const [item] = await service.importFiles(['C:\\videos\\sample.mp4']);

    expect(item.error).toBeNull();
    expect(item.metadata).toEqual(metadata);
    expect(item.thumbnailDataUrl).toBeNull();
    expect(item.thumbnailError).toContain('缩略图生成失败');
  });

  it('元数据失败只标记单项，不影响同批其他文件', async () => {
    const goodMetadata: MediaMetadata = {
      path: 'C:\\videos\\good.mp4',
      fileName: 'good.mp4',
      durationMs: 1000,
      width: 320,
      height: 240,
      frameRate: 25,
      containerFormat: 'MP4',
      videoCodec: 'H.264',
      audioCodec: null,
      hasAudio: false,
      fileSizeBytes: 2048,
    };

    const service = new MediaService({
      probe: async (filePath) => {
        if (filePath.includes('bad')) {
          throw new Error('无法读取视频：moov atom not found');
        }
        return goodMetadata;
      },
      extractThumbnail: async () => ({
        dataUrl: 'data:image/jpeg;base64,/9j/',
        width: 320,
        height: 180,
      }),
    });

    logger.info('STEP 同一批导入一个坏文件和一个好文件');
    const items = await service.importFiles(['C:\\videos\\bad.mp4', 'C:\\videos\\good.mp4']);

    expect(items).toHaveLength(2);
    expect(items[0].error).toContain('moov atom not found');
    expect(items[0].metadata).toBeNull();
    expect(items[1].error).toBeNull();
    expect(items[1].metadata?.fileName).toBe('good.mp4');
  });
});

// ============================================================================
// preload 契约
// ============================================================================

describe('阶段 2 / preload 契约', () => {
  it('保留受控的导入 API，并扩展到阶段 3 的转换 API', async () => {
    logger.info('STEP 检查 DesktopAPI 键');
    expect([...DESKTOP_API_KEYS].sort()).toEqual(
      expect.arrayContaining([
        'getAppInfo',
        'getFfmpegStatus',
        'selectVideos',
        'selectOutputDirectory',
        'startConversions',
        'cancelConversion',
        'onConversionUpdate',
      ]),
    );

    for (const forbidden of [
      'runCommand',
      'exec',
      'spawn',
      'ipcRenderer',
      'fs',
      'readFile',
      'showOpenDialog',
    ]) {
      expect(DESKTOP_API_KEYS).not.toContain(forbidden);
    }

    logger.info('STEP 验证新 API 的 IPC 通道');
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.getFfmpegStatus) return { available: true };
      if (channel === IPC_CHANNELS.selectVideos) return [];
      return {};
    });
    const api = createDesktopApi(invoke);

    await api.getFfmpegStatus();
    await api.selectVideos();

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.getFfmpegStatus,
      IPC_CHANNELS.selectVideos,
    ]);
  });
});

// ============================================================================
// 导入 UI
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

const unavailableStatus: FfmpegStatus = {
  available: false,
  ffmpegPath: null,
  ffprobePath: null,
  version: null,
  ffprobeVersion: null,
  source: null,
  error: '未找到 FFmpeg，请安装并加入 PATH，或放到 resources/ffmpeg。',
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

function stubDesktopApi(overrides: Partial<DesktopAPI> = {}) {
  const api: DesktopAPI = {
    getAppInfo: vi.fn().mockResolvedValue(appInfo),
    getFfmpegStatus: vi.fn().mockResolvedValue(readyStatus),
    selectVideos: vi.fn().mockResolvedValue([]),
    importVideos: vi.fn().mockResolvedValue([]),
    getPathForFile: vi.fn(() => ''),
    selectOutputDirectory: vi.fn().mockResolvedValue(null),
    startConversions: vi.fn().mockResolvedValue([]),
    cancelConversion: vi.fn().mockResolvedValue(undefined),
    onConversionUpdate: vi.fn(() => () => undefined),
    openOutputFile: vi.fn().mockResolvedValue(undefined),
    showOutputInFolder: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn().mockResolvedValue(undefined),
    openLogDirectory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  Object.defineProperty(window, 'desktopAPI', {
    configurable: true,
    value: api,
  });
  return api;
}

/** 等待 FFmpeg 状态加载完成，避免在按钮仍禁用时点击。 */
async function renderReadyApp() {
  render(<App />);
  expect(await screen.findByText('FFmpeg 已就绪')).toBeInTheDocument();
}

describe('阶段 2 / 导入 UI', () => {
  beforeEach(() => {
    stubDesktopApi();
  });

  it('空状态显示 FFmpeg 状态和真实可用的导入按钮', async () => {
    await renderReadyApp();

    logger.info('STEP 断言空状态和导入按钮');
    expect(screen.getByText('还没有导入视频')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /导入视频/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /开始转换/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/42%/)).not.toBeInTheDocument();
  });

  it('导入后显示缩略图、时长、分辨率、编码和大小', async () => {
    const api = stubDesktopApi({
      selectVideos: vi.fn().mockResolvedValue([sampleItem]),
    });
    await renderReadyApp();

    logger.info('STEP 点击导入按钮');
    fireEvent.click(screen.getByRole('button', { name: /导入视频/ }));

    logger.info('STEP 等待媒体卡片并断言真实字段');
    expect(await screen.findByText('测试 视频.mp4')).toBeInTheDocument();
    expect(screen.getByAltText('测试 视频.mp4 缩略图')).toBeInTheDocument();

    // 阶段 3 的格式/预设下拉也包含 MP4、H.264、AAC 文案，断言必须限定在媒体卡片内。
    const mediaCard = screen
      .getByRole('heading', { name: '测试 视频.mp4' })
      .closest('article');
    expect(mediaCard).not.toBeNull();
    const card = within(mediaCard as HTMLElement);
    expect(card.getByText(/00:02/)).toBeInTheDocument();
    expect(card.getByText(/320×240/)).toBeInTheDocument();
    expect(card.getByText(/30 fps/)).toBeInTheDocument();
    expect(card.getByText(/MP4/)).toBeInTheDocument();
    expect(card.getByText(/H\.264/)).toBeInTheDocument();
    expect(card.getByText(/AAC/)).toBeInTheDocument();
    expect(card.getByText(/1\.5 KB/)).toBeInTheDocument();
    expect(api.selectVideos).toHaveBeenCalledTimes(1);
  });

  it('无音轨、缩略图失败和损坏文件都显示可读状态', async () => {
    const noAudioItem: MediaItem = {
      ...sampleItem,
      path: 'C:\\videos\\no-audio.mp4',
      fileName: '无音轨.mp4',
      metadata: {
        ...sampleMetadata,
        path: 'C:\\videos\\no-audio.mp4',
        fileName: '无音轨.mp4',
        audioCodec: null,
        hasAudio: false,
      },
      thumbnailDataUrl: null,
      thumbnailError: '缩略图生成超时',
    };
    const corruptItem: MediaItem = {
      path: 'C:\\videos\\损坏 文件.mp4',
      fileName: '损坏 文件.mp4',
      metadata: null,
      thumbnailDataUrl: null,
      thumbnailError: null,
      error: '无法读取视频：moov atom not found',
    };

    stubDesktopApi({
      selectVideos: vi.fn().mockResolvedValue([noAudioItem, corruptItem]),
    });
    await renderReadyApp();

    logger.info('STEP 导入无音轨、缩略图失败和损坏文件');
    fireEvent.click(screen.getByRole('button', { name: /导入视频/ }));

    expect(await screen.findByText('无音轨.mp4')).toBeInTheDocument();
    const noAudioCard = screen.getByText('无音轨.mp4').closest('article');
    expect(noAudioCard).toHaveTextContent('无音轨·');
    expect(screen.getByText(/缩略图不可用/)).toBeInTheDocument();
    expect(screen.getAllByText('暂无缩略图')).toHaveLength(2);
    expect(screen.getByText(/moov atom not found/)).toBeInTheDocument();
  });

  it('导入失败显示可读错误，加载中禁用按钮', async () => {
    let resolveSelection!: (items: MediaItem[]) => void;
    const pending = new Promise<MediaItem[]>((resolve) => {
      resolveSelection = resolve;
    });
    stubDesktopApi({
      selectVideos: vi.fn().mockReturnValue(pending),
    });
    await renderReadyApp();

    logger.info('STEP 点击导入，观察加载状态');
    fireEvent.click(screen.getByRole('button', { name: /导入视频/ }));

    const loadingButton = await screen.findByRole('button', { name: /正在读取媒体信息/ });
    expect(loadingButton).toBeDisabled();

    logger.info('STEP 让选择流程结束');
    resolveSelection([]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /导入视频/ })).toBeEnabled();
    });

    const failingApi = stubDesktopApi({
      selectVideos: vi.fn().mockRejectedValue(new Error('文件选择器不可用')),
    });
    fireEvent.click(screen.getByRole('button', { name: /导入视频/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/文件选择器不可用/);
    expect(failingApi.selectVideos).toHaveBeenCalledTimes(1);
  });

  it('FFmpeg 未就绪时禁用导入并显示修复说明', async () => {
    stubDesktopApi({
      getFfmpegStatus: vi.fn().mockResolvedValue(unavailableStatus),
    });
    render(<App />);

    logger.info('STEP 等待 FFmpeg 未就绪状态');
    expect(await screen.findByText('FFmpeg 未就绪')).toBeInTheDocument();
    expect(screen.getByText(/未找到 FFmpeg/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导入视频/ })).toBeDisabled();
  });
});
