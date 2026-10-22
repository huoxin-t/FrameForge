import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  DEFAULT_ADVANCED_SETTINGS,
  buildPreviewOutputPath,
  getOutputFormat,
  isAudioOnlyFormat,
  type AdvancedConversionSettings,
  type ConversionJob,
  type ConversionUpdate,
  type OutputFormat,
  type QualityPresetId,
} from '../shared/conversion';
import { buildConversionArgs, formatCommandForDisplay } from '../shared/conversion-args';
import type { ConversionCapabilities } from '../shared/capabilities';
import {
  mergeHistoryEntries,
  type ConversionHistoryEntry,
} from '../shared/history';
import type { FfmpegStatus, MediaItem } from '../shared/media';
import { getParentDirectory } from '../shared/path';
import { AppShell } from './components/AppShell';
import { ConversionSettings } from './components/ConversionSettings';
import { EmptyState } from './components/EmptyState';
import { FfmpegErrorBanner } from './components/FfmpegErrorBanner';
import { HistoryCard } from './components/HistoryCard';
import { JobQueue } from './components/JobQueue';
import { MediaList } from './components/MediaList';
import type { AppInfoState, FfmpegState } from './types/ui';

export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfoState>({ status: 'loading' });
  const [ffmpeg, setFfmpeg] = useState<FfmpegState>({ status: 'loading' });
  const [capabilities, setCapabilities] =
    useState<ConversionCapabilities | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [format, setFormat] = useState<OutputFormat>('mp4');
  const [qualityPreset, setQualityPreset] =
    useState<QualityPresetId>('compatible');
  const [advanced, setAdvanced] = useState<AdvancedConversionSettings>({
    ...DEFAULT_ADVANCED_SETTINGS,
  });
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [starting, setStarting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversionHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const mountedRef = useRef(true);
  const dragDepthRef = useRef(0);

  const validItems = useMemo(
    () => items.filter((item) => item.metadata !== null && item.error === null),
    [items],
  );
  const selectedProfile = getOutputFormat(format);
  const convertibleItems = useMemo(
    () =>
      validItems.filter(
        (item) =>
          selectedProfile.kind !== 'audio' || item.metadata?.hasAudio === true,
      ),
    [validItems, selectedProfile.kind],
  );
  const audioOnlyExcludedCount =
    selectedProfile.kind === 'audio'
      ? validItems.filter((item) => item.metadata?.hasAudio !== true).length
      : 0;
  const hasActiveJobs = jobs.some(
    (job) => job.status === 'queued' || job.status === 'running',
  );
  const activeSourcePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const job of jobs) {
      if (job.status === 'queued' || job.status === 'running') {
        paths.add(job.sourcePath.toLowerCase());
      }
    }
    return paths;
  }, [jobs]);
  const previewItem = convertibleItems[0] ?? null;
  const commandPreview = useMemo(() => {
    if (!previewItem?.metadata) {
      return null;
    }

    try {
      const outputPath = buildPreviewOutputPath(
        outputDirectory,
        previewItem.fileName,
        format,
      );
      const args = buildConversionArgs({
        inputPath: previewItem.path,
        outputPath,
        format,
        qualityPreset,
        hasAudio:
          previewItem.metadata.hasAudio && advanced.audioMode !== 'remove',
        sourceWidth: previewItem.metadata.width,
        sourceHeight: previewItem.metadata.height,
        advanced,
      });
      const executable =
        ffmpeg.status === 'ready'
          ? (ffmpeg.info.ffmpegPath ?? 'ffmpeg')
          : 'ffmpeg';
      return formatCommandForDisplay(executable, args);
    } catch {
      return null;
    }
  }, [
    advanced,
    ffmpeg,
    format,
    outputDirectory,
    previewItem,
    qualityPreset,
  ]);
  const previewNote = previewItem
    ? `示例：${previewItem.fileName}；实际输出名会自动避让同名文件。`
    : '导入视频后可预览实际参数。';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCapabilities = useCallback(async () => {
    const api = window.desktopAPI;
    if (!api) {
      setCapabilitiesError('桌面桥接未加载');
      setCapabilitiesLoading(false);
      return;
    }

    setCapabilitiesLoading(true);
    try {
      const next = await api.getConversionCapabilities();
      if (mountedRef.current) {
        setCapabilities(next);
        setCapabilitiesError(next.error);
      }
    } catch (error) {
      if (mountedRef.current) {
        setCapabilitiesError(toUserMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setCapabilitiesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  useEffect(() => {
    const api = window.desktopAPI;
    if (!api) {
      setAppInfo({ status: 'error', message: '桌面桥接未加载' });
      setFfmpeg({ status: 'error', message: '桌面桥接未加载' });
      return;
    }

    let active = true;

    api
      .getAppInfo()
      .then((info) => {
        if (active) {
          setAppInfo({ status: 'ready', info });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setAppInfo({ status: 'error', message: toUserMessage(error) });
        }
      });

    api
      .getFfmpegStatus()
      .then((status) => {
        if (active) {
          setFfmpeg(toFfmpegState(status));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setFfmpeg({ status: 'error', message: toUserMessage(error) });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const api = window.desktopAPI;
    if (!api || typeof api.onConversionUpdate !== 'function') {
      return;
    }

    return api.onConversionUpdate((update: ConversionUpdate) => {
      if (mountedRef.current) {
        setJobs((current) => upsertConversionJob(current, update.job));
      }
    });
  }, []);

  useEffect(() => {
    const api = window.desktopAPI;
    if (!api) {
      setHistoryLoading(false);
      setHistoryError('桌面桥接未加载');
      return;
    }

    let active = true;
    setHistoryLoading(true);
    api
      .getConversionHistory()
      .then((entries) => {
        if (active && mountedRef.current) {
          setHistory((current) =>
            entries.reduce(
              (merged, entry) => mergeHistoryEntries(merged, entry),
              current,
            ),
          );
          setHistoryError(null);
        }
      })
      .catch((error: unknown) => {
        if (active && mountedRef.current) {
          setHistoryError(toUserMessage(error));
        }
      })
      .finally(() => {
        if (active && mountedRef.current) {
          setHistoryLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const api = window.desktopAPI;
    if (!api || typeof api.onHistoryUpdated !== 'function') {
      return;
    }

    return api.onHistoryUpdated((entry) => {
      if (mountedRef.current) {
        setHistory((current) => mergeHistoryEntries(current, entry));
      }
    });
  }, []);

  useEffect(() => {
    if (!capabilities) {
      return;
    }

    const current = capabilities.formats.find((item) => item.format === format);
    if (current?.available) {
      return;
    }

    const fallback = capabilities.formats.find((item) => item.available);
    if (fallback) {
      setFormat(fallback.format);
    }
  }, [capabilities, format]);

  const handleRetryFfmpeg = useCallback(async () => {
    const api = window.desktopAPI;
    if (!api) {
      setFfmpeg({ status: 'error', message: '桌面桥接未加载' });
      return;
    }

    setFfmpeg({ status: 'loading' });
    try {
      const status = await api.getFfmpegStatus();
      if (mountedRef.current) {
        setFfmpeg(toFfmpegState(status));
      }
      await loadCapabilities();
    } catch (error) {
      if (mountedRef.current) {
        setFfmpeg({ status: 'error', message: toUserMessage(error) });
      }
    }
  }, [loadCapabilities]);

  const canImport = ffmpeg.status === 'ready' && !importing;

  const applyImportedItems = useCallback((incoming: MediaItem[]) => {
    if (incoming.length > 0) {
      setItems((current) => mergeMediaItems(current, incoming));

      // 只有用户尚未选择目录时才跟随首个源文件；手动选择后不再覆盖。
      const firstValid = incoming.find(
        (item) => item.metadata !== null && item.error === null,
      );
      const defaultDirectory = firstValid
        ? getParentDirectory(firstValid.path)
        : null;
      if (defaultDirectory) {
        setOutputDirectory((current) => current ?? defaultDirectory);
      }
    }
  }, []);

  const handleRemoveItem = useCallback(
    (item: MediaItem) => {
      if (activeSourcePaths.has(item.path.toLowerCase())) {
        return;
      }

      setItems((current) =>
        current.filter(
          (candidate) =>
            candidate.path.toLowerCase() !== item.path.toLowerCase(),
        ),
      );
    },
    [activeSourcePaths],
  );

  const handleImport = useCallback(async () => {
    const api = window.desktopAPI;
    if (!api || importing || ffmpeg.status !== 'ready') {
      return;
    }

    setImportError(null);
    setImporting(true);

    try {
      const selected = await api.selectVideos();
      if (mountedRef.current) {
        applyImportedItems(selected);
      }
    } catch (error) {
      if (mountedRef.current) {
        setImportError(toUserMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setImporting(false);
      }
    }
  }, [applyImportedItems, ffmpeg.status, importing]);

  const handleImportPaths = useCallback(
    async (paths: string[]) => {
      const api = window.desktopAPI;
      if (!api || importing || ffmpeg.status !== 'ready' || paths.length === 0) {
        return;
      }

      setImportError(null);
      setImporting(true);

      try {
        const imported = await api.importVideos(paths);
        if (mountedRef.current) {
          applyImportedItems(imported);
        }
      } catch (error) {
        if (mountedRef.current) {
          setImportError(toUserMessage(error));
        }
      } finally {
        if (mountedRef.current) {
          setImporting(false);
        }
      }
    },
    [applyImportedItems, ffmpeg.status, importing],
  );

  const handleDragEnter = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current += 1;
      if (ffmpeg.status === 'ready' && !importing) {
        setDragActive(true);
      }
    },
    [ffmpeg.status, importing],
  );

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback(
    (_event: ReactDragEvent<HTMLDivElement>) => {
      // dragleave 的 dataTransfer.types 在部分 Chromium 版本里会变成空数组，
      // 不能据此提前返回，否则覆盖层可能残留。
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setDragActive(false);
      }
    },
    [],
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);

      const api = window.desktopAPI;
      if (!api) {
        setImportError('桌面桥接未加载');
        return;
      }

      if (ffmpeg.status !== 'ready') {
        setImportError('FFmpeg 未就绪，无法导入视频');
        return;
      }

      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) {
        setImportError('没有识别到可导入的文件');
        return;
      }

      const paths = files
        .map((file) => api.getPathForFile(file))
        .filter((path) => Boolean(path));
      if (paths.length === 0) {
        setImportError('无法读取拖入文件的本地路径');
        return;
      }

      void handleImportPaths(paths);
    },
    [ffmpeg.status, handleImportPaths],
  );

  const handleChooseDirectory = useCallback(async () => {
    const api = window.desktopAPI;
    if (!api) {
      return;
    }

    setConversionError(null);
    try {
      const directory = await api.selectOutputDirectory();
      if (mountedRef.current && directory) {
        setOutputDirectory(directory);
      }
    } catch (error) {
      if (mountedRef.current) {
        setConversionError(toUserMessage(error));
      }
    }
  }, []);

  const handleFormatChange = useCallback((next: OutputFormat) => {
    setFormat(next);
    setConversionError(null);
    if (isAudioOnlyFormat(next)) {
      setAdvanced((current) => ({ ...current, audioMode: 'keep' }));
    }
  }, []);

  const handleCopyCommand = useCallback(async (command: string) => {
    const api = window.desktopAPI;
    if (!api) {
      throw new Error('桌面桥接未加载');
    }
    await api.copyText(command);
  }, []);

  const handleStartConversion = useCallback(async () => {
    const api = window.desktopAPI;
    if (
      !api ||
      starting ||
      ffmpeg.status !== 'ready' ||
      !outputDirectory ||
      convertibleItems.length === 0
    ) {
      return;
    }

    const selectedCapability = capabilities?.formats.find(
      (item) => item.format === format,
    );
    if (!selectedCapability?.available) {
      setConversionError(
        selectedCapability?.reason ??
          '当前格式缺少可用编码器，请选择其他输出格式',
      );
      return;
    }

    setConversionError(null);
    setStarting(true);

    try {
      const created = await api.startConversions({
        sourcePaths: convertibleItems.map((item) => item.path),
        settings: {
          format,
          qualityPreset,
          outputDirectory,
          advanced,
        },
      });

      if (mountedRef.current) {
        setJobs((current) => mergeStartedJobs(current, created));
      }
    } catch (error) {
      if (mountedRef.current) {
        setConversionError(toUserMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setStarting(false);
      }
    }
  }, [
    advanced,
    capabilities,
    convertibleItems,
    ffmpeg.status,
    format,
    outputDirectory,
    qualityPreset,
    starting,
  ]);

  const handleCancelConversion = useCallback(async (jobId: string) => {
    const api = window.desktopAPI;
    if (!api) {
      return;
    }

    setConversionError(null);
    try {
      await api.cancelConversion(jobId);
    } catch (error) {
      if (mountedRef.current) {
        setConversionError(toUserMessage(error));
      }
    }
  }, []);

  const handleOpenOutputFile = useCallback(async (jobId: string) => {
    const api = window.desktopAPI;
    if (!api) {
      return;
    }

    setConversionError(null);
    try {
      await api.openOutputFile(jobId);
    } catch (error) {
      if (mountedRef.current) {
        setConversionError(toUserMessage(error));
      }
    }
  }, []);

  const handleShowOutputInFolder = useCallback(async (jobId: string) => {
    const api = window.desktopAPI;
    if (!api) {
      return;
    }

    setConversionError(null);
    try {
      await api.showOutputInFolder(jobId);
    } catch (error) {
      if (mountedRef.current) {
        setConversionError(toUserMessage(error));
      }
    }
  }, []);

  const handleCopyError = useCallback(async (job: ConversionJob) => {
    const api = window.desktopAPI;
    if (!api) {
      throw new Error('桌面桥接未加载');
    }

    const sections = [
      `文件：${job.fileName}`,
      `错误：${job.error ?? '未知错误'}`,
    ];
    if (job.logExcerpt) {
      sections.push('', 'FFmpeg 日志：', job.logExcerpt);
    }

    setConversionError(null);
    try {
      await api.copyText(sections.join('\n'));
    } catch (error) {
      if (mountedRef.current) {
        setConversionError(toUserMessage(error));
      }
      throw error;
    }
  }, []);

  const handleClearHistory = useCallback(async () => {
    const api = window.desktopAPI;
    if (!api) {
      return;
    }

    setHistoryError(null);
    try {
      await api.clearConversionHistory();
      if (mountedRef.current) {
        setHistory([]);
      }
    } catch (error) {
      if (mountedRef.current) {
        setHistoryError(toUserMessage(error));
      }
      throw error;
    }
  }, []);

  const handleOpenHistoryOutput = useCallback(
    async (entry: ConversionHistoryEntry) => {
      const api = window.desktopAPI;
      if (!api) {
        return;
      }

      setHistoryError(null);
      try {
        await api.openHistoryOutput(entry.id);
      } catch (error) {
        if (mountedRef.current) {
          setHistoryError(toUserMessage(error));
        }
      }
    },
    [],
  );

  const handleShowHistoryOutputInFolder = useCallback(
    async (entry: ConversionHistoryEntry) => {
      const api = window.desktopAPI;
      if (!api) {
        return;
      }

      setHistoryError(null);
      try {
        await api.showHistoryOutputInFolder(entry.id);
      } catch (error) {
        if (mountedRef.current) {
          setHistoryError(toUserMessage(error));
        }
      }
    },
    [],
  );

  const handleCopyHistoryError = useCallback(
    async (entry: ConversionHistoryEntry) => {
      const api = window.desktopAPI;
      if (!api) {
        throw new Error('桌面桥接未加载');
      }

      const sections = [
        `文件：${entry.fileName}`,
        `错误：${entry.error ?? '未知错误'}`,
      ];
      if (entry.logExcerpt) {
        sections.push('', 'FFmpeg 日志：', entry.logExcerpt);
      }

      setHistoryError(null);
      try {
        await api.copyText(sections.join('\n'));
      } catch (error) {
        if (mountedRef.current) {
          setHistoryError(toUserMessage(error));
        }
        throw error;
      }
    },
    [],
  );

  const handleOpenLogDirectory = useCallback(async () => {
    const api = window.desktopAPI;
    if (!api) {
      return;
    }

    setConversionError(null);
    try {
      await api.openLogDirectory();
    } catch (error) {
      if (mountedRef.current) {
        setConversionError(toUserMessage(error));
      }
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void handleImport();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void handleStartConversion();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleImport, handleStartConversion]);

  return (
    <AppShell
      version={appInfo.status === 'ready' ? appInfo.info.version : undefined}
      ffmpeg={ffmpeg}
      onOpenLogDirectory={handleOpenLogDirectory}
    >
      <div
        data-testid="workspace-dropzone"
        className="relative mx-auto grid min-h-full w-full max-w-[1360px] gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_340px]"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragActive ? (
          <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-xl border-2 border-dashed border-amber-300/70 bg-[#0b0d12]/90">
            <div className="text-center">
              <p className="text-lg font-medium text-amber-200">松开以导入视频</p>
              <p className="mt-1 text-xs text-slate-400">
                支持 MP4、MOV、MKV、AVI、WebM
              </p>
            </div>
          </div>
        ) : null}

        <div className="min-w-0">
          {ffmpeg.status === 'error' ? (
            <FfmpegErrorBanner
              message={ffmpeg.message}
              onRetry={handleRetryFfmpeg}
              onOpenLogDirectory={handleOpenLogDirectory}
            />
          ) : null}

          {importError ? (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-xs leading-5 text-rose-200"
            >
              导入失败：{importError}
            </div>
          ) : null}

          {items.length === 0 ? (
            <EmptyState
              onImport={handleImport}
              importing={importing}
              disabled={!canImport}
            />
          ) : (
            <MediaList
              items={items}
              onImport={handleImport}
              onRemove={handleRemoveItem}
              activeSourcePaths={activeSourcePaths}
              importing={importing}
              disabled={!canImport}
            />
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          {validItems.length > 0 ? (
            <ConversionSettings
              format={format}
              qualityPreset={qualityPreset}
              outputDirectory={outputDirectory}
              itemCount={convertibleItems.length}
              starting={starting}
              disabled={
                ffmpeg.status !== 'ready' ||
                hasActiveJobs ||
                capabilitiesLoading
              }
              error={conversionError}
              capabilities={capabilities}
              capabilitiesLoading={capabilitiesLoading}
              capabilitiesError={capabilitiesError}
              audioOnlyExcludedCount={audioOnlyExcludedCount}
              advanced={advanced}
              commandPreview={commandPreview}
              previewNote={previewNote}
              onFormatChange={handleFormatChange}
              onQualityPresetChange={setQualityPreset}
              onAdvancedChange={setAdvanced}
              onChooseDirectory={handleChooseDirectory}
              onRefreshCapabilities={loadCapabilities}
              onCopyCommand={handleCopyCommand}
              onStart={handleStartConversion}
            />
          ) : null}

          <JobQueue
            jobs={jobs}
            onCancel={handleCancelConversion}
            onOpenOutput={handleOpenOutputFile}
            onOpenOutputDirectory={handleShowOutputInFolder}
            onCopyError={handleCopyError}
            onOpenLogDirectory={handleOpenLogDirectory}
          />

          <HistoryCard
            entries={history}
            loading={historyLoading}
            error={historyError}
            onOpenOutput={(entry) => void handleOpenHistoryOutput(entry)}
            onOpenOutputDirectory={(entry) =>
              void handleShowHistoryOutputInFolder(entry)
            }
            onCopyError={handleCopyHistoryError}
            onClear={handleClearHistory}
          />
        </aside>
      </div>
    </AppShell>
  );
}

/** 按绝对路径去重；重复导入同一文件不会产生第二张卡片。 */
export function mergeMediaItems(
  current: MediaItem[],
  incoming: MediaItem[],
): MediaItem[] {
  const byPath = new Map(current.map((item) => [item.path, item]));

  for (const item of incoming) {
    if (!byPath.has(item.path)) {
      byPath.set(item.path, item);
    }
  }

  return [...byPath.values()];
}

/** 更新单个任务；事件可能先于 startConversions 的返回值到达。 */
export function upsertConversionJob(
  current: ConversionJob[],
  incoming: ConversionJob,
): ConversionJob[] {
  const index = current.findIndex((job) => job.id === incoming.id);
  if (index < 0) {
    return [...current, incoming];
  }

  const next = [...current];
  next[index] = incoming;
  return next;
}

/** 启动响应只补充新任务，不能把已经到达的更新状态回退。 */
export function mergeStartedJobs(
  current: ConversionJob[],
  created: ConversionJob[],
): ConversionJob[] {
  const known = new Set(current.map((job) => job.id));
  const next = [...current];

  for (const job of created) {
    if (!known.has(job.id)) {
      known.add(job.id);
      next.push(job);
    }
  }

  return next;
}

function toFfmpegState(status: FfmpegStatus): FfmpegState {
  return status.available
    ? { status: 'ready', info: status }
    : {
        status: 'error',
        message: status.error ?? '视频引擎未就绪',
      };
}

function toUserMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(
      /^Error invoking remote method '[^']+': Error: /,
      '',
    );
  }
  return '操作失败，请重试';
}
