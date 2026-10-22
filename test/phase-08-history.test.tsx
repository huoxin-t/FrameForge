/**
 * 阶段 8：可折叠命令预览、源目录默认值和持久化转换历史。
 *
 * 目标：
 * - FFmpeg 命令预览在高级设置内部拥有独立的展开/收起状态；
 * - 首次导入视频后，输出目录默认使用首个源文件所在目录；
 * - 完成、失败、取消三种终态会写入主进程历史，并在右侧栏展示；
 * - 历史跨重启保留、最多 200 条，文件丢失时禁止打开；
 * - renderer 只通过 history id 请求操作，不直接传路径。
 *
 * 本文件先于实现编写，真实 RED 记录在 test-results/phase8-history-red.log。
 */
import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from '../src/App';
import { AdvancedSettings } from '../src/components/AdvancedSettings';
import { HistoryCard } from '../src/components/HistoryCard';
import {
  ConversionQueue,
  type ConversionQueueDependencies,
} from '../electron/main/services/conversion/queue';
import {
  createConversionHistoryStore,
  parseHistoryId,
} from '../electron/main/services/history/store';
import {
  DEFAULT_ADVANCED_SETTINGS,
  type ConversionJob,
  type ConversionSettings,
} from '../shared/conversion';
import {
  MAX_CONVERSION_HISTORY_ENTRIES,
  mergeHistoryEntries,
  type ConversionHistoryEntry,
} from '../shared/history';
import { getFileName, getParentDirectory } from '../shared/path';
import type { AppInfo, DesktopAPI } from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipc';
import { createDesktopApi } from '../electron/preload/api';
import type { ConversionUpdate } from '../shared/conversion';
import type { MediaItem } from '../shared/media';
import { readyCapabilities } from './helpers/capabilities';
import { createTestLogger } from './helpers/test-logger';

const logger = createTestLogger('phase-08');

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'frameforge-phase08-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const baseSettings: ConversionSettings = {
  format: 'mp4',
  qualityPreset: 'compatible',
  outputDirectory: 'C:\\输出 目录',
  advanced: { ...DEFAULT_ADVANCED_SETTINGS },
};

function makeJob(overrides: Partial<ConversionJob> = {}): ConversionJob {
  return {
    id: 'job-1',
    sourcePath: 'C:\\媒体 样本\\源 视频.mp4',
    fileName: '源 视频.mp4',
    outputPath: 'C:\\媒体 样本\\源 视频_converted.mp4',
    status: 'completed',
    progress: 100,
    error: null,
    logExcerpt: null,
    startedAt: 1_000,
    finishedAt: 5_000,
    elapsedMs: 4_000,
    speed: null,
    etaSeconds: null,
    ...overrides,
  };
}

function makeHistoryEntry(
  overrides: Partial<ConversionHistoryEntry> = {},
): ConversionHistoryEntry {
  return {
    id: 'history-1',
    sourcePath: 'C:\\媒体 样本\\源 视频.mp4',
    fileName: '源 视频.mp4',
    outputPath: 'C:\\媒体 样本\\源 视频_converted.mp4',
    format: 'mp4',
    qualityPreset: 'compatible',
    advanced: { ...DEFAULT_ADVANCED_SETTINGS },
    status: 'completed',
    startedAt: 1_000,
    finishedAt: 5_000,
    elapsedMs: 4_000,
    error: null,
    logExcerpt: null,
    outputExists: true,
    ...overrides,
  };
}

const appInfo: AppInfo = {
  name: 'FrameForge',
  version: '0.1.0',
  electronVersion: '45.0.0',
  chromeVersion: '140.0.0',
  nodeVersion: '24.0.0',
  platform: 'win32',
  arch: 'x64',
};

const readyStatus = {
  available: true,
  ffmpegPath: 'C:\\tools\\ffmpeg.exe',
  ffprobePath: 'C:\\tools\\ffprobe.exe',
  version: '8.0.1',
  ffprobeVersion: '8.0.1',
  source: 'bundled' as const,
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

function stubDesktopApi(overrides: Partial<DesktopAPI> = {}) {
  const updateListeners: Array<(update: ConversionUpdate) => void> = [];
  const historyListeners: Array<(entry: ConversionHistoryEntry) => void> = [];
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
    getConversionHistory: vi.fn().mockResolvedValue([]),
    clearConversionHistory: vi.fn().mockResolvedValue(undefined),
    openHistoryOutput: vi.fn().mockResolvedValue(undefined),
    showHistoryOutputInFolder: vi.fn().mockResolvedValue(undefined),
    onConversionUpdate: vi.fn((listener: (update: ConversionUpdate) => void) => {
      updateListeners.push(listener);
      return () => {
        const index = updateListeners.indexOf(listener);
        if (index >= 0) {
          updateListeners.splice(index, 1);
        }
      };
    }),
    onHistoryUpdated: vi.fn(
      (listener: (entry: ConversionHistoryEntry) => void) => {
        historyListeners.push(listener);
        return () => {
          const index = historyListeners.indexOf(listener);
          if (index >= 0) {
            historyListeners.splice(index, 1);
          }
        };
      },
    ),
    ...overrides,
  };

  Object.defineProperty(window, 'desktopAPI', {
    configurable: true,
    value: api,
  });

  return {
    api,
    emitHistory: (entry: ConversionHistoryEntry) => {
      for (const listener of [...historyListeners]) {
        listener(entry);
      }
    },
  };
}

describe('阶段 8 / 跨平台路径', () => {
  it('从 Windows、中文空格、盘符根和 UNC 路径中取父目录', () => {
    logger.info('STEP 断言 Windows 中文空格路径');
    expect(getParentDirectory('C:\\媒体 样本\\测试 视频.mp4')).toBe(
      'C:\\媒体 样本',
    );
    expect(getParentDirectory('D:/项目 资料/成片.mp4')).toBe('D:/项目 资料');

    logger.info('STEP 断言盘符根目录和 UNC 路径');
    expect(getParentDirectory('C:\\视频.mp4')).toBe('C:\\');
    expect(getParentDirectory('\\\\服务器\\共享\\文件夹\\视频.mp4')).toBe(
      '\\\\服务器\\共享\\文件夹',
    );
    expect(getParentDirectory('/home/user/video.mp4')).toBe('/home/user');
    expect(getParentDirectory('只有文件名.mp4')).toBeNull();

    logger.info('STEP 断言文件名提取');
    expect(getFileName('C:\\媒体 样本\\测试 视频.mp4')).toBe('测试 视频.mp4');
    expect(getFileName('\\\\服务器\\共享\\成片.mkv')).toBe('成片.mkv');
  });
});

describe('阶段 8 / 历史存储', () => {
  it('只记录终态、去重、跨实例持久化并保留最近 200 条', async () => {
    const root = createTempRoot();
    const filePath = join(root, 'history.json');
    let sequence = 0;
    const pathExists = vi.fn(async (path: string) =>
      path.endsWith('_converted.mp4'),
    );
    const store = createConversionHistoryStore({
      filePath,
      pathExists,
      generateId: () => `history-${++sequence}`,
    });

    logger.info('STEP 队列态和运行态不写历史');
    expect(await store.record(makeJob({ status: 'queued' }), baseSettings)).toBeNull();
    expect(await store.record(makeJob({ status: 'running' }), baseSettings)).toBeNull();

    logger.info('STEP 完成态写入真实设置和验证结果');
    const completed = await store.record(makeJob(), baseSettings);
    expect(completed).toMatchObject({
      id: 'history-1',
      status: 'completed',
      format: 'mp4',
      qualityPreset: 'compatible',
      outputExists: true,
    });
    expect(completed?.advanced).toEqual(DEFAULT_ADVANCED_SETTINGS);

    logger.info('STEP 同一任务重复通知只记录一次');
    expect(await store.record(makeJob(), baseSettings)).toBeNull();

    logger.info('STEP 失败和取消也写入历史');
    await store.record(
      makeJob({
        id: 'job-2',
        status: 'failed',
        outputPath: '',
        error: '输出校验失败',
      }),
      { ...baseSettings, format: 'webm' },
    );
    await store.record(
      makeJob({ id: 'job-3', status: 'canceled', outputPath: '' }),
      { ...baseSettings, format: 'mkv' },
    );

    logger.info('STEP 重新创建实例后仍能读取');
    const reloaded = createConversionHistoryStore({ filePath, pathExists });
    const persisted = await reloaded.list();
    expect(persisted).toHaveLength(3);
    expect(persisted.map((entry) => entry.status)).toEqual([
      'canceled',
      'failed',
      'completed',
    ]);

    logger.info('STEP 记录超过上限时淘汰最旧记录');
    for (let index = 0; index < MAX_CONVERSION_HISTORY_ENTRIES + 5; index += 1) {
      await reloaded.record(
        makeJob({
          id: `job-extra-${index}`,
          outputPath: `C:\\输出 目录\\批量_${index}_converted.mp4`,
        }),
        baseSettings,
      );
    }
    const capped = await reloaded.list();
    expect(capped).toHaveLength(MAX_CONVERSION_HISTORY_ENTRIES);

    logger.info('STEP 清空历史只清记录');
    await reloaded.clear();
    expect(await reloaded.list()).toEqual([]);
  });

  it('损坏的 JSON 会备份并回退为空历史，不阻塞应用', async () => {
    const root = createTempRoot();
    const filePath = join(root, 'history.json');
    writeFileSync(filePath, '{ 这不是合法 JSON', 'utf8');

    const store = createConversionHistoryStore({
      filePath,
      pathExists: async () => true,
    });

    logger.info('STEP 读取损坏文件');
    expect(await store.list()).toEqual([]);

    logger.info('STEP 断言损坏文件已备份');
    const backups = readdirSync(root).filter((name) =>
      name.startsWith('history.json.corrupt-'),
    );
    expect(backups).toHaveLength(1);
  });

  it('历史 id 只接受有限长度的普通字符串', () => {
    expect(parseHistoryId('history-123')).toBe('history-123');
    expect(() => parseHistoryId('')).toThrow('历史记录 ID 无效');
    expect(() => parseHistoryId('x'.repeat(201))).toThrow('历史记录 ID 无效');
    expect(() => parseHistoryId({ id: 'history-1' })).toThrow(
      '历史记录 ID 无效',
    );
  });
});

describe('阶段 8 / preload 历史契约', () => {
  it('历史读取、清空、操作和事件都走类型化通道', async () => {
    const historyEntry = makeHistoryEntry();
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.getConversionHistory) {
        return [historyEntry];
      }
      return undefined;
    });
    let payloadListener: (payload: unknown) => void = () => undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(
      (_channel: string, listener: (payload: unknown) => void) => {
        payloadListener = listener;
        return unsubscribe;
      },
    );
    const api = createDesktopApi(invoke, subscribe);

    logger.info('STEP 读取与清空历史');
    expect(await api.getConversionHistory()).toEqual([historyEntry]);
    await api.clearConversionHistory();
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.getConversionHistory);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.clearConversionHistory);

    logger.info('STEP 历史操作只传 id');
    await api.openHistoryOutput('history-1');
    await api.showHistoryOutputInFolder('history-1');
    expect(invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.openHistoryOutput,
      'history-1',
    );
    expect(invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.showHistoryOutputInFolder,
      'history-1',
    );

    logger.info('STEP 订阅历史事件并验证取消订阅');
    const listener = vi.fn();
    const cancel = api.onHistoryUpdated(listener);
    expect(subscribe).toHaveBeenCalledWith(
      IPC_CHANNELS.historyUpdated,
      expect.any(Function),
    );
    payloadListener(historyEntry);
    expect(listener).toHaveBeenCalledWith(historyEntry);
    cancel();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('阶段 8 / 队列终态通知', () => {
  it('完成、失败和取消只向历史回调通知一次', async () => {
    const terminal: Array<{
      id: string;
      status: ConversionJob['status'];
      format: string | null;
    }> = [];
    let sequence = 0;
    let sourceIndex = 0;
    const dependencies: ConversionQueueDependencies = {
      runJob: async (job) => ({ outputPath: job.outputPath }),
      validateSource: async (sourcePath) => {
        sourceIndex += 1;
        if (sourceIndex === 2) {
          return { ok: false, error: '源文件损坏' };
        }
        return { ok: true, path: sourcePath };
      },
      validateOutputDirectory: async (directory) => ({
        ok: true,
        path: directory,
      }),
      findOutputPath: async () => 'C:\\输出 目录\\成片_converted.mp4',
      pathExists: async () => false,
      now: () => 10_000,
      generateId: () => `job-${++sequence}`,
      onTerminal: (job, settings) => {
        terminal.push({
          id: job.id,
          status: job.status,
          format: settings?.format ?? null,
        });
      },
    };
    const queue = new ConversionQueue(dependencies);

    logger.info('STEP 入队三个任务：完成、失败、完成');
    await queue.enqueue(
      [
        'C:\\媒体 样本\\正常 一.mp4',
        'C:\\媒体 样本\\损坏.mp4',
        'C:\\媒体 样本\\正常 二.mp4',
      ],
      baseSettings,
    );
    await queue.waitForIdle();

    expect([...terminal].sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      { id: 'job-1', status: 'completed', format: 'mp4' },
      { id: 'job-2', status: 'failed', format: 'mp4' },
      { id: 'job-3', status: 'completed', format: 'mp4' },
    ]);
  });
  it('取消运行中任务只通知一次取消终态', async () => {
    const terminal: Array<{
      id: string;
      status: ConversionJob['status'];
      format: string | null;
    }> = [];
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let sequence = 0;
    const queue = new ConversionQueue({
      runJob: (_job, _settings, { signal }) =>
        new Promise<{ outputPath: string }>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('测试超时')), 10_000);
          signalStarted();
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('run aborted'));
            },
            { once: true },
          );
        }),
      validateSource: async (sourcePath) => ({ ok: true, path: sourcePath }),
      validateOutputDirectory: async (directory) => ({
        ok: true,
        path: directory,
      }),
      findOutputPath: async () =>
        'C:\\输出 目录\\取消 任务_converted.mp4',
      pathExists: async () => false,
      now: () => 20_000,
      generateId: () => `job-cancel-${++sequence}`,
      onTerminal: (job, settings) => {
        terminal.push({
          id: job.id,
          status: job.status,
          format: settings?.format ?? null,
        });
      },
    });

    const [job] = await queue.enqueue(
      ['C:\\媒体 样本\\取消 任务.mp4'],
      baseSettings,
    );
    await started;

    logger.info('STEP 连续取消两次，队列只应写入一个终态');
    queue.cancel(job.id);
    queue.cancel(job.id);
    await queue.waitForIdle();

    expect(terminal).toEqual([
      { id: 'job-cancel-1', status: 'canceled', format: 'mp4' },
    ]);
  });
});

describe('阶段 8 / 历史卡片', () => {
  it('展示终态、筛选、打开输出并二次确认清空', async () => {
    const entries = [
      makeHistoryEntry(),
      makeHistoryEntry({
        id: 'history-2',
        status: 'failed',
        outputPath: '',
        error: '输出文件校验失败',
        outputExists: false,
      }),
      makeHistoryEntry({
        id: 'history-3',
        status: 'canceled',
        outputPath: '',
        outputExists: false,
      }),
    ];
    const onOpenOutput = vi.fn();
    const onOpenOutputDirectory = vi.fn();
    const onCopyError = vi.fn().mockResolvedValue(undefined);
    const onClear = vi.fn().mockResolvedValue(undefined);

    render(
      <HistoryCard
        entries={entries}
        loading={false}
        error={null}
        onOpenOutput={onOpenOutput}
        onOpenOutputDirectory={onOpenOutputDirectory}
        onCopyError={onCopyError}
        onClear={onClear}
      />,
    );

    logger.info('STEP 默认显示全部终态和文件名');
    expect(screen.getByText('转换历史')).toBeInTheDocument();
    expect(screen.getByText('源 视频_converted.mp4')).toBeInTheDocument();
    expect(screen.getByText('输出文件校验失败')).toBeInTheDocument();
    expect(screen.getByText('已取消')).toBeInTheDocument();

    logger.info('STEP 筛选失败记录');
    fireEvent.click(screen.getByRole('button', { name: '失败' }));
    expect(screen.queryByText('源 视频_converted.mp4')).not.toBeInTheDocument();
    expect(screen.getByText('输出文件校验失败')).toBeInTheDocument();

    logger.info('STEP 复制失败错误');
    fireEvent.click(screen.getByRole('button', { name: /复制错误/ }));
    await waitFor(() => expect(onCopyError).toHaveBeenCalledTimes(1));

    logger.info('STEP 回到全部并打开完成输出');
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    expect(onOpenOutput).toHaveBeenCalledWith(entries[0]);
    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    expect(onOpenOutputDirectory).toHaveBeenCalledWith(entries[0]);

    logger.info('STEP 清空历史需要二次确认');
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(screen.getByText('确认清空历史？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }));
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
  });

  it('输出文件不存在时禁用打开，只保留记录', () => {
    render(
      <HistoryCard
        entries={[
          makeHistoryEntry({
            outputExists: false,
          }),
        ]}
        loading={false}
        error={null}
        onOpenOutput={vi.fn()}
        onOpenOutputDirectory={vi.fn()}
        onCopyError={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText('输出文件不存在')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开文件' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '打开文件夹' })).toBeDisabled();
  });

  it('默认显示前 5 条，展开全部后显示完整历史并可收起', () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      makeHistoryEntry({
        id: `history-${index + 1}`,
        outputPath: `C:\\媒体 样本\\源 ${index + 1}_converted.mp4`,
        finishedAt: 10_000 - index,
      }),
    );

    render(
      <HistoryCard
        entries={entries}
        loading={false}
        error={null}
        onOpenOutput={vi.fn()}
        onOpenOutputDirectory={vi.fn()}
        onCopyError={vi.fn().mockResolvedValue(undefined)}
        onClear={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    logger.info('STEP 默认只显示最近 5 条');
    expect(screen.getByText('源 1_converted.mp4')).toBeInTheDocument();
    expect(screen.getByText('源 5_converted.mp4')).toBeInTheDocument();
    expect(screen.queryByText('源 6_converted.mp4')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '展开全部 7 条' }),
    ).toBeInTheDocument();

    logger.info('STEP 展开全部后显示第 6、7 条');
    fireEvent.click(screen.getByRole('button', { name: '展开全部 7 条' }));
    expect(screen.getByText('源 6_converted.mp4')).toBeInTheDocument();
    expect(screen.getByText('源 7_converted.mp4')).toBeInTheDocument();

    logger.info('STEP 收起后回到最近 5 条');
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByText('源 6_converted.mp4')).not.toBeInTheDocument();
    expect(screen.getByText('源 5_converted.mp4')).toBeInTheDocument();
  });
});

describe('阶段 8 / 命令预览折叠', () => {
  it('高级设置内部可以独立展开和收起命令预览', () => {
    render(
      <AdvancedSettings
        advanced={{ ...DEFAULT_ADVANCED_SETTINGS }}
        format="mp4"
        qualityPreset="compatible"
        disabled={false}
        commandPreview="ffmpeg -i 输入.mp4 输出.mp4"
        previewNote="示例命令"
        onAdvancedChange={vi.fn()}
        onCopyCommand={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /高级设置/ }));
    expect(screen.getByTestId('command-preview')).toBeVisible();

    logger.info('STEP 收起命令预览');
    fireEvent.click(screen.getByRole('button', { name: /FFmpeg 命令预览/ }));
    expect(screen.queryByTestId('command-preview')).not.toBeInTheDocument();

    logger.info('STEP 再次展开命令预览');
    fireEvent.click(screen.getByRole('button', { name: /FFmpeg 命令预览/ }));
    expect(screen.getByTestId('command-preview')).toBeInTheDocument();
  });
});

describe('阶段 8 / App 接线', () => {
  it('首次导入后默认输出到源文件目录，手动选择后不被覆盖', async () => {
    const selectOutputDirectory = vi
      .fn()
      .mockResolvedValue('D:\\手动 输出');
    stubDesktopApi({
      selectVideos: vi.fn().mockResolvedValue([appMediaItem]),
      selectOutputDirectory,
      getConversionHistory: vi.fn().mockResolvedValue([]),
    });

    render(<App />);
    expect(await screen.findByText('FFmpeg 已就绪')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /导入视频/ }));

    logger.info('STEP 默认显示首个源文件目录');
    expect(await screen.findByText('C:\\媒体 样本')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始转换' })).toBeEnabled();

    logger.info('STEP 手动选择目录后使用手动目录');
    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    expect(await screen.findByText('D:\\手动 输出')).toBeInTheDocument();
    expect(screen.queryByText('C:\\媒体 样本')).not.toBeInTheDocument();
  });

  it('启动读取与主进程推送并发时互相合并且不覆盖', async () => {
    const existing = makeHistoryEntry({ id: 'history-existing' });
    const pushed = makeHistoryEntry({
      id: 'history-pushed',
      outputPath: 'C:\\媒体 样本\\新 视频_converted.mp4',
    });
    let resolveHistory: (entries: ConversionHistoryEntry[]) => void = () =>
      undefined;
    const getConversionHistory = vi.fn(
      () =>
        new Promise<ConversionHistoryEntry[]>((resolve) => {
          resolveHistory = resolve;
        }),
    );
    const harness = stubDesktopApi({ getConversionHistory });

    render(<App />);
    expect(getConversionHistory).toHaveBeenCalledTimes(1);

    logger.info('STEP 初始读取未返回时先收到主进程推送');
    await act(async () => {
      harness.emitHistory(pushed);
    });
    expect(screen.getByText('正在读取历史…')).toBeInTheDocument();

    logger.info('STEP 初始读取返回后保留已推送记录并合并旧记录');
    await act(async () => {
      resolveHistory([existing]);
      await Promise.resolve();
    });
    expect(await screen.findByText('源 视频_converted.mp4')).toBeInTheDocument();
    expect(screen.getByText('新 视频_converted.mp4')).toBeInTheDocument();
  });

  it('合并历史时按时间倒序、按 id 去重并限制 200 条', () => {
    const first = makeHistoryEntry({ id: 'history-1', finishedAt: 100 });
    const second = makeHistoryEntry({ id: 'history-2', finishedAt: 200 });
    const replacement = makeHistoryEntry({
      id: 'history-1',
      finishedAt: 300,
      status: 'failed',
    });

    const merged = mergeHistoryEntries([first, second], replacement);
    expect(merged.map((entry) => entry.id)).toEqual([
      'history-1',
      'history-2',
    ]);
    expect(merged[0].status).toBe('failed');

    const many = Array.from(
      { length: MAX_CONVERSION_HISTORY_ENTRIES + 5 },
      (_, index) =>
        makeHistoryEntry({
          id: `history-${index}`,
          finishedAt: index,
        }),
    );
    expect(
      mergeHistoryEntries([], many[0], MAX_CONVERSION_HISTORY_ENTRIES),
    ).toHaveLength(1);
    const capped = mergeHistoryEntries(
      many,
      makeHistoryEntry({ id: 'history-new', finishedAt: 999 }),
    );
    expect(capped).toHaveLength(MAX_CONVERSION_HISTORY_ENTRIES);
    expect(capped[0].id).toBe('history-new');
  });
});
