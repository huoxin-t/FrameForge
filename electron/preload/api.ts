import {
  IPC_CHANNELS,
  type AppInfo,
  type DesktopAPI,
} from '../../shared/ipc';
import type { ConversionJob, ConversionUpdate, StartConversionsRequest } from '../../shared/conversion';
import type { ConversionCapabilities } from '../../shared/capabilities';
import type { ConversionHistoryEntry } from '../../shared/history';
import type { FfmpegStatus, MediaItem } from '../../shared/media';

export type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;
export type Subscribe = (
  channel: string,
  listener: (payload: unknown) => void,
) => () => void;
export type ResolveFilePath = (file: File) => string;

const noopSubscribe: Subscribe = () => () => undefined;
const unresolvedFilePath: ResolveFilePath = () => '';

export function createDesktopApi(
  invoke: Invoke,
  subscribe: Subscribe = noopSubscribe,
  resolveFilePath: ResolveFilePath = unresolvedFilePath,
): DesktopAPI {
  return {
    getAppInfo: () => invoke(IPC_CHANNELS.getAppInfo) as Promise<AppInfo>,
    getFfmpegStatus: () =>
      invoke(IPC_CHANNELS.getFfmpegStatus) as Promise<FfmpegStatus>,
    getConversionCapabilities: () =>
      invoke(IPC_CHANNELS.getConversionCapabilities) as Promise<ConversionCapabilities>,
    selectVideos: () => invoke(IPC_CHANNELS.selectVideos) as Promise<MediaItem[]>,
    importVideos: (paths: string[]) =>
      invoke(IPC_CHANNELS.importPaths, paths) as Promise<MediaItem[]>,
    getPathForFile: (file: File) => resolveFilePath(file),
    selectOutputDirectory: () =>
      invoke(IPC_CHANNELS.selectOutputDirectory) as Promise<string | null>,
    startConversions: (request: StartConversionsRequest) =>
      invoke(IPC_CHANNELS.startConversions, request) as Promise<ConversionJob[]>,
    cancelConversion: (jobId: string) =>
      invoke(IPC_CHANNELS.cancelConversion, jobId) as Promise<void>,
    onConversionUpdate: (callback: (update: ConversionUpdate) => void) =>
      subscribe(IPC_CHANNELS.conversionUpdate, (payload) => {
        callback(payload as ConversionUpdate);
      }),
    getConversionHistory: () =>
      invoke(IPC_CHANNELS.getConversionHistory) as Promise<
        ConversionHistoryEntry[]
      >,
    clearConversionHistory: () =>
      invoke(IPC_CHANNELS.clearConversionHistory) as Promise<void>,
    onHistoryUpdated: (callback: (entry: ConversionHistoryEntry) => void) =>
      subscribe(IPC_CHANNELS.historyUpdated, (payload) => {
        callback(payload as ConversionHistoryEntry);
      }),
    openHistoryOutput: (historyId: string) =>
      invoke(IPC_CHANNELS.openHistoryOutput, historyId) as Promise<void>,
    showHistoryOutputInFolder: (historyId: string) =>
      invoke(IPC_CHANNELS.showHistoryOutputInFolder, historyId) as Promise<void>,
    openOutputFile: (jobId: string) =>
      invoke(IPC_CHANNELS.openOutputFile, jobId) as Promise<void>,
    showOutputInFolder: (jobId: string) =>
      invoke(IPC_CHANNELS.showOutputInFolder, jobId) as Promise<void>,
    copyText: (text: string) =>
      invoke(IPC_CHANNELS.copyText, text) as Promise<void>,
    openLogDirectory: () =>
      invoke(IPC_CHANNELS.openLogDirectory) as Promise<void>,
  };
}
