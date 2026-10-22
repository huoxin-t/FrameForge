/**
 * 阶段 5：Windows 交付基线测试。
 *
 * 目标：
 * - 随包 FFmpeg 按 <platform>-<arch> 目录解析，同时保留旧的 flat 目录兼容；
 * - 打包配置真实包含 ffmpeg 资源、NSIS 安装包和便携 zip；
 * - 主界面移除开发者环境面板，但 FFmpeg 缺失时仍给出可操作错误；
 * - 错误状态可以重新检测，不要求普通用户自己安装 FFmpeg。
 *
 * 本文件先于实现编写；真实 RED 记录在 test-results/phase5-delivery-red.log。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import App from '../src/App';
import { resolveFfmpegPaths } from '../electron/main/services/ffmpeg/resolver';
import { FfmpegService } from '../electron/main/services/ffmpeg/status';
import type { AppInfo, DesktopAPI } from '../shared/ipc';
import type { FfmpegStatus } from '../shared/media';
import { createTestLogger } from './helpers/test-logger';
import { readyCapabilities } from './helpers/capabilities';

const logger = createTestLogger('phase-05');

const appInfo: AppInfo = {
  name: 'FrameForge',
  version: '0.1.0',
  electronVersion: '45.0.0',
  chromeVersion: '140.0.0',
  nodeVersion: '24.0.0',
  platform: 'win32',
  arch: 'x64',
};

const missingStatus: FfmpegStatus = {
  available: false,
  ffmpegPath: null,
  ffprobePath: null,
  version: null,
  ffprobeVersion: null,
  source: null,
  error: '未找到内置 FFmpeg。请重新安装 FrameForge，或打开日志目录查看详情。',
};

const readyStatus: FfmpegStatus = {
  available: true,
  ffmpegPath: 'C:\\app\\resources\\ffmpeg\\win32-x64\\ffmpeg.exe',
  ffprobePath: 'C:\\app\\resources\\ffmpeg\\win32-x64\\ffprobe.exe',
  version: '8.0.1',
  ffprobeVersion: '8.0.1',
  source: 'bundled',
  error: null,
};

function createAccess(existing: string[]) {
  const set = new Set(existing);
  return async (path: string) => set.has(path);
}

function stubDesktopApi(overrides: Partial<DesktopAPI> = {}) {
  const api: DesktopAPI = {
    getAppInfo: vi.fn().mockResolvedValue(appInfo),
    getFfmpegStatus: vi.fn().mockResolvedValue(missingStatus),
    getConversionCapabilities: vi.fn().mockResolvedValue(readyCapabilities),
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
    getConversionHistory: vi.fn().mockResolvedValue([]),
    clearConversionHistory: vi.fn().mockResolvedValue(undefined),
    onHistoryUpdated: vi.fn(() => () => undefined),
    openHistoryOutput: vi.fn().mockResolvedValue(undefined),
    showHistoryOutputInFolder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  Object.defineProperty(window, 'desktopAPI', {
    configurable: true,
    value: api,
  });

  return api;
}

// ============================================================================
// 随包路径解析
// ============================================================================

describe('阶段 5 / FFmpeg 随包布局', () => {
  it('打包模式优先解析 resources/ffmpeg/<platform>-<arch>', async () => {
    logger.info('STEP 准备 platform-arch 随包目录');

    const resourcesPath = join('C:\\app', 'resources');
    const platformDirectory = join(resourcesPath, 'ffmpeg', 'win32-x64');
    const platformPaths = [
      join(platformDirectory, 'ffmpeg.exe'),
      join(platformDirectory, 'ffprobe.exe'),
    ];

    const result = await resolveFfmpegPaths({
      isPackaged: true,
      resourcesPath,
      appPath: 'C:\\app',
      platform: 'win32',
      arch: 'x64',
      env: { PATH: '' },
      access: createAccess(platformPaths),
    });

    expect(result).toMatchObject({
      source: 'bundled',
      directory: platformDirectory,
      ffmpegPath: platformPaths[0],
      ffprobePath: platformPaths[1],
    });
  });

  it('开发模式支持 platform-arch，并保留旧 flat 目录回退', async () => {
    logger.info('STEP 准备开发模式 platform-arch 目录');

    const appPath = join('C:\\work', 'FrameForge');
    const platformDirectory = join(appPath, 'resources', 'ffmpeg', 'win32-x64');
    const platformPaths = [
      join(platformDirectory, 'ffmpeg.exe'),
      join(platformDirectory, 'ffprobe.exe'),
    ];

    const platformResult = await resolveFfmpegPaths({
      isPackaged: false,
      resourcesPath: '',
      appPath,
      platform: 'win32',
      arch: 'x64',
      env: { PATH: '' },
      access: createAccess(platformPaths),
    });

    expect(platformResult).toMatchObject({
      source: 'bundled',
      directory: platformDirectory,
    });

    logger.info('STEP 只有旧 flat 目录时仍可解析');

    const flatDirectory = join(appPath, 'resources', 'ffmpeg');
    const flatPaths = [
      join(flatDirectory, 'ffmpeg.exe'),
      join(flatDirectory, 'ffprobe.exe'),
    ];

    const flatResult = await resolveFfmpegPaths({
      isPackaged: false,
      resourcesPath: '',
      appPath,
      platform: 'win32',
      arch: 'x64',
      env: { PATH: '' },
      access: createAccess(flatPaths),
    });

    expect(flatResult).toMatchObject({
      source: 'bundled',
      directory: flatDirectory,
    });
  });
});

// ============================================================================
// 打包配置
// ============================================================================

describe('阶段 5 / 打包配置', () => {
  it('包含 FFmpeg extraResources、NSIS 安装包和便携 zip', () => {
    logger.info('STEP 读取 package.json 构建配置');

    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
      build?: {
        extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>;
        win?: { target?: Array<string | { target?: string }> };
      };
    };

    expect(packageJson.scripts?.['prepare:ffmpeg']).toBeTruthy();
    expect(existsSync(join(process.cwd(), 'scripts', 'prepare-ffmpeg.mjs'))).toBe(true);
    expect(packageJson.build?.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'resources/ffmpeg',
          to: 'ffmpeg',
        }),
      ]),
    );

    const targets = packageJson.build?.win?.target ?? [];
    const targetNames = targets.map((target) =>
      typeof target === 'string' ? target : target.target,
    );
    expect(targetNames).toEqual(expect.arrayContaining(['nsis', 'zip']));
  });
});

// ============================================================================
// 主界面错误态
// ============================================================================

describe('阶段 5 / 主界面交付体验', () => {
  it('不再展示运行环境面板，但 FFmpeg 缺失时给出重装和日志入口', async () => {
    logger.info('STEP 渲染 FFmpeg 缺失状态');

    stubDesktopApi();
    render(<App />);

    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText('视频引擎未就绪')).toBeInTheDocument();
    expect(within(banner).getByText(/重新安装/)).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: '重新检测' })).toBeInTheDocument();
    expect(
      within(banner).getByRole('button', { name: /打开日志目录/ }),
    ).toBeInTheDocument();

    logger.info('STEP 确认开发者环境信息已从主界面移除');

    expect(screen.queryByText('运行环境')).not.toBeInTheDocument();
    expect(screen.queryByText('Node.js')).not.toBeInTheDocument();
    expect(screen.queryByText('FFmpeg 路径')).not.toBeInTheDocument();
    expect(screen.queryByText('win32 · x64')).not.toBeInTheDocument();
  });

  it('点击重新检测会再次读取 FFmpeg 状态并恢复可用界面', async () => {
    logger.info('STEP 准备首次失败、第二次成功的状态响应');

    const getFfmpegStatus = vi
      .fn()
      .mockResolvedValueOnce(missingStatus)
      .mockResolvedValueOnce(readyStatus);
    stubDesktopApi({ getFfmpegStatus });

    render(<App />);
    await screen.findByText('视频引擎未就绪');

    logger.info('STEP 点击重新检测');
    fireEvent.click(screen.getByRole('button', { name: '重新检测' }));

    expect(await screen.findByText('FFmpeg 已就绪')).toBeInTheDocument();
    expect(getFfmpegStatus).toHaveBeenCalledTimes(2);
  });

  it('随包缺失错误不要求普通用户自己安装 FFmpeg', async () => {
    logger.info('STEP 让路径解析返回空');

    const service = new FfmpegService({
      resolvePaths: async () => null,
    });

    const status = await service.getStatus();

    expect(status.available).toBe(false);
    expect(status.error).toMatch(/内置|随包/);
    expect(status.error).toMatch(/重新安装|日志/);
    expect(status.error).not.toMatch(/加入 PATH|resources\/ffmpeg/);
  });
});
