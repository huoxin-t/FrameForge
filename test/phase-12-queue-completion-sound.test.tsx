/**
 * 阶段 12 测试：任务队列全部完毕后播放提示音。
 *
 * 约束：
 * - 队列里还有排队/转换中的任务时不提前播放；
 * - 最后一个任务进入终态（完成、失败或取消）时只播放一次；
 * - 首次渲染、清空已结束任务不会误触发。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import App from '../src/App';
import type { ConversionJob, ConversionUpdate } from '../shared/conversion';
import type { AppInfo, DesktopAPI } from '../shared/ipc';
import type { MediaItem } from '../shared/media';
import { readyCapabilities } from './helpers/capabilities';

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

const sampleItem: MediaItem = {
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
  thumbnailDataUrl: null,
  thumbnailError: null,
  error: null,
};

function makeJob(overrides: Partial<ConversionJob> = {}): ConversionJob {
  return {
    id: 'job-1',
    sourcePath: sampleItem.path,
    fileName: sampleItem.fileName,
    outputPath: 'C:\\媒体 样本\\测试 视频_converted.mp4',
    status: 'queued',
    progress: 0,
    error: null,
    logExcerpt: null,
    startedAt: null,
    finishedAt: null,
    elapsedMs: null,
    speed: null,
    etaSeconds: null,
    ...overrides,
  };
}

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
    getConversionHistory: vi.fn().mockResolvedValue([]),
    clearConversionHistory: vi.fn().mockResolvedValue(undefined),
    openHistoryOutput: vi.fn().mockResolvedValue(undefined),
    showHistoryOutputInFolder: vi.fn().mockResolvedValue(undefined),
    onHistoryUpdated: vi.fn(() => () => undefined),
    onConversionUpdate: vi.fn(
      (listener: (update: ConversionUpdate) => void) => {
        updateListeners.push(listener);
        return () => {
          const index = updateListeners.indexOf(listener);
          if (index >= 0) {
            updateListeners.splice(index, 1);
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
    emit: (job: ConversionJob) => {
      for (const listener of [...updateListeners]) {
        listener({ job });
      }
    },
  };
}

async function startQueue(jobs: ConversionJob[]) {
  const harness = stubDesktopApi({
    selectVideos: vi.fn().mockResolvedValue([sampleItem]),
    startConversions: vi.fn().mockResolvedValue(jobs),
  });

  render(<App />);
  expect(await screen.findByText('FFmpeg 已就绪')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /导入视频/ }));
  expect(await screen.findByText(sampleItem.fileName)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '开始转换' }));
  expect(await screen.findAllByText('排队中')).toHaveLength(jobs.length);

  return harness;
}

function mockAudioPlay() {
  return vi
    .spyOn(window.HTMLMediaElement.prototype, 'play')
    .mockResolvedValue(undefined);
}

describe('阶段 12 / 队列全部完毕提示音', () => {
  it('最后一个任务结束前不播放，全部结束后只播放一次', async () => {
    const play = mockAudioPlay();
    const harness = await startQueue([
      makeJob({ id: 'job-1' }),
      makeJob({ id: 'job-2' }),
    ]);

    expect(play).not.toHaveBeenCalled();

    await act(async () => {
      harness.emit(makeJob({ id: 'job-1', status: 'running', progress: 40 }));
    });
    await act(async () => {
      harness.emit(
        makeJob({
          id: 'job-1',
          status: 'completed',
          progress: 100,
          outputPath: 'C:\\媒体 样本\\测试 视频_converted.mp4',
        }),
      );
    });

    // job-2 还在队列里，不能提前播放。
    expect(play).not.toHaveBeenCalled();

    await act(async () => {
      harness.emit(makeJob({ id: 'job-2', status: 'running', progress: 60 }));
    });
    await act(async () => {
      harness.emit(
        makeJob({
          id: 'job-2',
          status: 'completed',
          progress: 100,
          outputPath: 'C:\\媒体 样本\\测试 视频_converted (1).mp4',
        }),
      );
    });

    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1);
    });

    // 清空已经结束的任务不会重复播放。
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1);
    });
  });

  it('最后一个任务失败或取消也算队列完毕', async () => {
    const play = mockAudioPlay();
    const harness = await startQueue([
      makeJob({ id: 'job-1' }),
      makeJob({ id: 'job-2' }),
    ]);

    await act(async () => {
      harness.emit(makeJob({ id: 'job-1', status: 'canceled', progress: 0 }));
    });
    expect(play).not.toHaveBeenCalled();

    await act(async () => {
      harness.emit(
        makeJob({
          id: 'job-2',
          status: 'failed',
          progress: 0,
          error: '输出校验失败',
        }),
      );
    });

    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1);
    });
  });
});
