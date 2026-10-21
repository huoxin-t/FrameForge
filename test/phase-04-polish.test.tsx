/**
 * 阶段 4：产品体验收尾测试。
 *
 * 目标：
 * - 拖拽导入只接受主进程可验证的绝对路径和已知视频扩展名；
 * - 输出文件/目录、复制错误和日志目录都走受控 IPC，不接受任意路径；
 * - 有任务运行时关闭窗口必须确认、取消并等待真实子进程退出；
 * - 完成任务和失败任务在 UI 上显示真实可用的操作，而不是装饰按钮；
 * - 窄窗口、拖拽覆盖层和快捷键不破坏主流程。
 *
 * 真实 RED 记录在 test-results/phase4-red.log。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import App from '../src/App';
import { createCloseGuard } from '../electron/main/services/close-guard';
import {
  OutputActionError,
  openCompletedOutput,
  revealCompletedOutput,
} from '../electron/main/services/conversion/output-actions';
import { parseClipboardText } from '../electron/main/services/conversion/validation';
import { parseVideoPaths } from '../electron/main/services/media/import-validation';
import { openExistingDirectory } from '../electron/main/services/system/open-path';
import { ConversionQueue, type ConversionQueueDependencies } from '../electron/main/services/conversion/queue';
import { createDesktopApi } from '../electron/preload/api';
import type {
  ConversionJob,
  ConversionSettings,
} from '../shared/conversion';
import {
  DESKTOP_API_KEYS,
  IPC_CHANNELS,
  type AppInfo,
  type DesktopAPI,
} from '../shared/ipc';
import type { FfmpegStatus, MediaItem, MediaMetadata } from '../shared/media';
import { createTestLogger } from './helpers/test-logger';

const logger = createTestLogger('phase-04');

const appInfo: AppInfo = {
  name: 'FrameForge',
  version: '0.1.0',
  electronVersion: '45.0.0',
  chromeVersion: '156.0.0',
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
  source: 'system',
  error: null,
};

const sampleMetadata: MediaMetadata = {
  path: 'C:\\视频 样本\\测试 视频.mp4',
  fileName: '测试 视频.mp4',
  durationMs: 4017,
  width: 640,
  height: 360,
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

const completedJob: ConversionJob = {
  id: 'job-completed',
  sourcePath: sampleItem.path,
  fileName: sampleItem.fileName,
  outputPath: 'C:\\输出 目录\\测试 视频_converted.mp4',
  status: 'completed',
  progress: 100,
  error: null,
  logExcerpt: null,
  startedAt: 100,
  finishedAt: 200,
};

const failedJob: ConversionJob = {
  id: 'job-failed',
  sourcePath: sampleItem.path,
  fileName: sampleItem.fileName,
  outputPath: 'C:\\输出 目录\\测试 视频_converted.mp4',
  status: 'failed',
  progress: 31,
  error: '转换失败：编码器无法打开输出流',
  logExcerpt: 'Error while opening encoder for output stream #0:0',
  startedAt: 100,
  finishedAt: 200,
};

const settings: ConversionSettings = {
  format: 'mp4',
  qualityPreset: 'compatible',
  outputDirectory: 'C:\\输出 目录',
};

// ============================================================================
// 主进程边界：导入路径、剪贴板、输出操作和关闭保护
// ============================================================================

describe('阶段 4 / 主进程边界', () => {
  it('只接受绝对路径的视频文件，并去重', () => {
    logger.info('STEP 校验拖拽导入路径');

    expect(
      parseVideoPaths([
        'C:\\视频 样本\\测试 视频.mp4',
        'C:\\视频 样本\\测试 视频.MP4',
        'C:\\视频 样本\\无音轨.mkv',
      ]),
    ).toEqual([
      'C:\\视频 样本\\测试 视频.mp4',
      'C:\\视频 样本\\无音轨.mkv',
    ]);

    expect(() => parseVideoPaths([])).toThrow(/至少/);
    expect(() => parseVideoPaths('C:\\a.mp4')).toThrow(/路径/);
    expect(() => parseVideoPaths(['relative.mp4'])).toThrow(/绝对路径/);
    expect(() => parseVideoPaths(['C:\\a.txt'])).toThrow(/视频/);
    expect(() =>
      parseVideoPaths(
        Array.from({ length: 101 }, (_, index) => `C:\\videos\\${index}.mp4`),
      ),
    ).toThrow(/100/);
  });

  it('复制内容必须是有限长度的非空字符串', () => {
    logger.info('STEP 校验复制错误文本');

    expect(parseClipboardText('转换失败：编码器错误')).toBe(
      '转换失败：编码器错误',
    );
    expect(() => parseClipboardText('')).toThrow(/不能为空/);
    expect(() => parseClipboardText('x'.repeat(20_001))).toThrow(/过长/);
  });

  it('只允许打开已完成任务的真实输出文件', async () => {
    logger.info('STEP 校验打开文件和所在目录');

    const dependencies = {
      openPath: vi.fn().mockResolvedValue(''),
      showItemInFolder: vi.fn(),
      pathExists: vi.fn().mockResolvedValue(true),
    };

    await openCompletedOutput(completedJob, dependencies);
    expect(dependencies.openPath).toHaveBeenCalledWith(completedJob.outputPath);

    await revealCompletedOutput(completedJob, dependencies);
    expect(dependencies.showItemInFolder).toHaveBeenCalledWith(
      completedJob.outputPath,
    );

    await expect(
      openCompletedOutput({ ...completedJob, status: 'running' }, dependencies),
    ).rejects.toBeInstanceOf(OutputActionError);
    await expect(
      openCompletedOutput(null, dependencies),
    ).rejects.toThrow(/尚未成功完成/);

    await expect(
      openCompletedOutput(completedJob, {
        ...dependencies,
        pathExists: vi.fn().mockResolvedValue(false),
      }),
    ).rejects.toThrow(/输出文件已不存在/);

    await expect(
      openCompletedOutput(completedJob, {
        ...dependencies,
        openPath: vi.fn().mockResolvedValue('没有可用的播放器'),
      }),
    ).rejects.toThrow(/无法打开/);
  });

  it('打开日志目录前检查目录是否存在', async () => {
    logger.info('STEP 校验日志目录打开流程');

    const openPath = vi.fn().mockResolvedValue('');
    await openExistingDirectory('C:\\日志 目录', {
      openPath,
      pathExists: vi.fn().mockResolvedValue(true),
    });
    expect(openPath).toHaveBeenCalledWith('C:\\日志 目录');

    await expect(
      openExistingDirectory('C:\\不存在', {
        openPath,
        pathExists: vi.fn().mockResolvedValue(false),
      }),
    ).rejects.toThrow(/不存在/);
  });

  it('关闭窗口时只有在用户确认后才取消任务并退出', async () => {
    logger.info('STEP 校验关闭确认和取消队列');

    const noActiveEvent = { preventDefault: vi.fn() };
    const noActive = createCloseGuard({
      hasActiveJobs: () => false,
      confirmExit: vi.fn().mockResolvedValue(true),
      cancelAll: vi.fn(),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      closeWindow: vi.fn(),
    });
    await noActive(noActiveEvent);
    expect(noActiveEvent.preventDefault).not.toHaveBeenCalled();

    const stayEvent = { preventDefault: vi.fn() };
    const cancelAll = vi.fn();
    const closeWindow = vi.fn();
    const stay = createCloseGuard({
      hasActiveJobs: () => true,
      confirmExit: vi.fn().mockResolvedValue(false),
      cancelAll,
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      closeWindow,
    });
    await stay(stayEvent);
    expect(stayEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(cancelAll).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();

    const exitEvent = { preventDefault: vi.fn() };
    const exit = createCloseGuard({
      hasActiveJobs: () => true,
      confirmExit: vi.fn().mockResolvedValue(true),
      cancelAll,
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      closeWindow,
    });
    await exit(exitEvent);
    expect(exitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('队列支持按 id 查询、判断忙碌和取消全部任务', async () => {
    logger.info('STEP 构造真实状态机的假任务');

    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const observed: { signal: AbortSignal | null } = { signal: null };

    const runJob: ConversionQueueDependencies['runJob'] = async (
      _job,
      _settings,
      options,
    ) => {
      observed.signal = options.signal;
      started();

      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
      });
    };

    const queue = new ConversionQueue({
      runJob,
      validateSource: async (path) => ({ ok: true, path }),
      validateOutputDirectory: async (directory) => ({
        ok: true,
        path: directory,
      }),
      findOutputPath: async (directory, fileName, format) =>
        `${directory}\\${fileName.replace(/\.[^.]+$/, '')}_converted.${format}`,
      pathExists: async () => false,
      generateId: () => 'job-close-test',
    });

    const [job] = await queue.enqueue([sampleItem.path], settings);
    await startedPromise;

    expect(queue.hasActiveJobs()).toBe(true);
    expect(queue.getJob(job.id)?.status).toBe('running');
    expect(queue.getJob('missing')).toBeNull();

    const snapshot = queue.getJob(job.id);
    expect(snapshot).not.toBeNull();
    if (snapshot) {
      snapshot.status = 'failed';
    }
    expect(queue.getJob(job.id)?.status).toBe('running');

    queue.cancelAll();
    await queue.waitForIdle();

    expect(observed.signal?.aborted).toBe(true);
    expect(queue.getJob(job.id)?.status).toBe('canceled');
    expect(queue.hasActiveJobs()).toBe(false);
  });
});

// ============================================================================
// preload 契约
// ============================================================================

describe('阶段 4 / preload 契约', () => {
  it('暴露拖拽、打开输出、复制和日志入口，不暴露危险能力', async () => {
    logger.info('STEP 检查新增 DesktopAPI 键和 IPC 通道');

    expect([...DESKTOP_API_KEYS].sort()).toEqual([
      'cancelConversion',
      'copyText',
      'getAppInfo',
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
      'shell',
      'clipboard',
    ]) {
      expect(DESKTOP_API_KEYS).not.toContain(forbidden);
    }

    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.importPaths) {
        return [sampleItem];
      }
      return undefined;
    });
    const getPathForFile = vi.fn(() => sampleItem.path);
    const api = createDesktopApi(invoke, undefined, getPathForFile);

    await api.importVideos([sampleItem.path]);
    await api.openOutputFile(completedJob.id);
    await api.showOutputInFolder(completedJob.id);
    await api.copyText('转换失败');
    await api.openLogDirectory();

    const file = {} as File;
    expect(api.getPathForFile(file)).toBe(sampleItem.path);
    expect(getPathForFile).toHaveBeenCalledWith(file);

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.importPaths,
      IPC_CHANNELS.openOutputFile,
      IPC_CHANNELS.showOutputInFolder,
      IPC_CHANNELS.copyText,
      IPC_CHANNELS.openLogDirectory,
    ]);
  });
});

// ============================================================================
// 阶段 4 UI
// ============================================================================

function stubDesktopApi(overrides: Partial<DesktopAPI> = {}) {
  const updateListeners: Array<(update: { job: ConversionJob }) => void> = [];
  const api: DesktopAPI = {
    getAppInfo: vi.fn().mockResolvedValue(appInfo),
    getFfmpegStatus: vi.fn().mockResolvedValue(readyStatus),
    selectVideos: vi.fn().mockResolvedValue([]),
    importVideos: vi.fn().mockResolvedValue([]),
    getPathForFile: vi.fn(() => sampleItem.path),
    selectOutputDirectory: vi.fn().mockResolvedValue(null),
    startConversions: vi.fn().mockResolvedValue([]),
    cancelConversion: vi.fn().mockResolvedValue(undefined),
    openOutputFile: vi.fn().mockResolvedValue(undefined),
    showOutputInFolder: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn().mockResolvedValue(undefined),
    openLogDirectory: vi.fn().mockResolvedValue(undefined),
    onConversionUpdate: vi.fn((listener: (update: { job: ConversionJob }) => void) => {
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

  return api;
}

async function renderReadyApp(overrides: Partial<DesktopAPI> = {}) {
  const api = stubDesktopApi(overrides);
  render(<App />);
  expect(await screen.findByText('FFmpeg 已就绪')).toBeInTheDocument();
  return api;
}

async function renderImportedApp(overrides: Partial<DesktopAPI> = {}) {
  const api = await renderReadyApp({
    selectVideos: vi.fn().mockResolvedValue([sampleItem]),
    ...overrides,
  });
  fireEvent.click(screen.getByRole('button', { name: /导入视频/ }));
  expect(await screen.findByText(sampleItem.fileName)).toBeInTheDocument();
  return api;
}

async function renderWithFinishedJob(
  job: ConversionJob,
  overrides: Partial<DesktopAPI> = {},
) {
  const startConversions = vi.fn().mockResolvedValue([job]);
  const api = await renderImportedApp({
    selectOutputDirectory: vi.fn().mockResolvedValue('C:\\输出 目录'),
    startConversions,
    ...overrides,
  });

  fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
  await screen.findByText('C:\\输出 目录');
  fireEvent.click(screen.getByRole('button', { name: '开始转换' }));
  await screen.findByText(job.status === 'completed' ? '已完成' : '失败');

  return api;
}

describe('阶段 4 / 体验 UI', () => {
  it('不再把阶段编号暴露给普通用户，并显示拖拽提示', async () => {
    logger.info('STEP 检查产品文案');

    await renderReadyApp();

    expect(screen.queryByText(/阶段 3/)).not.toBeInTheDocument();
    expect(screen.getByText(/也可以把视频拖到/)).toBeInTheDocument();
    expect(screen.getAllByText(/Ctrl\+O/).length).toBeGreaterThan(0);
  });

  it('拖拽离开工作区会清除导入覆盖层', async () => {
    logger.info('STEP 模拟拖拽进入后离开');

    await renderReadyApp();
    const dropzone = screen.getByTestId('workspace-dropzone');

    fireEvent.dragEnter(dropzone, {
      dataTransfer: { files: [], types: ['Files'] },
    });
    expect(await screen.findByText('松开以导入视频')).toBeInTheDocument();

    fireEvent.dragLeave(dropzone, {
      dataTransfer: { files: [], types: [] },
    });
    await waitFor(() => {
      expect(screen.queryByText('松开以导入视频')).not.toBeInTheDocument();
    });
  });

  it('拖拽文件到工作区会调用受控导入 API', async () => {
    logger.info('STEP 模拟拖拽导入');

    const importVideos = vi.fn().mockResolvedValue([sampleItem]);
    const getPathForFile = vi.fn(() => sampleItem.path);
    await renderReadyApp({ importVideos, getPathForFile });

    const dropzone = screen.getByTestId('workspace-dropzone');
    fireEvent.dragEnter(dropzone, {
      dataTransfer: { files: [], types: ['Files'] },
    });
    expect(await screen.findByText('松开以导入视频')).toBeInTheDocument();

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [{}], types: ['Files'] },
    });

    await waitFor(() => {
      expect(importVideos).toHaveBeenCalledWith([sampleItem.path]);
    });
    expect(await screen.findByText(sampleItem.fileName)).toBeInTheDocument();
  });

  it('完成任务显示打开文件和打开所在目录', async () => {
    logger.info('STEP 检查完成任务的真实操作');

    const openOutputFile = vi.fn().mockResolvedValue(undefined);
    const showOutputInFolder = vi.fn().mockResolvedValue(undefined);
    await renderWithFinishedJob(completedJob, {
      openOutputFile,
      showOutputInFolder,
    });

    expect(screen.getByText(/完成 1/)).toBeInTheDocument();

    const card = screen.getByText('已完成').closest('article');
    expect(card).not.toBeNull();
    const actions = within(card as HTMLElement);

    fireEvent.click(actions.getByRole('button', { name: /打开文件/ }));
    await waitFor(() => {
      expect(openOutputFile).toHaveBeenCalledWith(completedJob.id);
    });

    fireEvent.click(actions.getByRole('button', { name: /打开所在目录/ }));
    await waitFor(() => {
      expect(showOutputInFolder).toHaveBeenCalledWith(completedJob.id);
    });
  });

  it('失败任务可以复制错误并显示已复制反馈', async () => {
    logger.info('STEP 检查失败任务的复制错误');

    const copyText = vi.fn().mockResolvedValue(undefined);
    await renderWithFinishedJob(failedJob, { copyText });

    const card = screen.getByText('失败').closest('article');
    expect(card).not.toBeNull();
    const actions = within(card as HTMLElement);

    fireEvent.click(actions.getByRole('button', { name: /复制错误/ }));

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(
        expect.stringContaining(failedJob.error ?? ''),
      );
    });
    expect(await actions.findByText('已复制')).toBeInTheDocument();
  });

  it('环境面板提供打开日志目录的真实入口', async () => {
    logger.info('STEP 点击打开日志目录');

    const openLogDirectory = vi.fn().mockResolvedValue(undefined);
    await renderReadyApp({ openLogDirectory });

    fireEvent.click(screen.getByRole('button', { name: /打开日志目录/ }));
    await waitFor(() => {
      expect(openLogDirectory).toHaveBeenCalledTimes(1);
    });
  });

  it('Ctrl+O 可以打开受控文件选择器', async () => {
    logger.info('STEP 触发 Ctrl+O 快捷键');

    const selectVideos = vi.fn().mockResolvedValue([]);
    await renderReadyApp({ selectVideos });

    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    await waitFor(() => {
      expect(selectVideos).toHaveBeenCalledTimes(1);
    });
  });
});
