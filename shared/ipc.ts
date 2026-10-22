import type {
  ConversionJob,
  ConversionUpdate,
  StartConversionsRequest,
} from './conversion';
import type { ConversionCapabilities } from './capabilities';
import type { ConversionHistoryEntry } from './history';
import type { FfmpegStatus, MediaItem } from './media';

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  getFfmpegStatus: 'ffmpeg:get-status',
  getConversionCapabilities: 'conversion:get-capabilities',
  selectVideos: 'media:select-videos',
  importPaths: 'media:import-paths',
  selectOutputDirectory: 'conversion:select-output-directory',
  startConversions: 'conversion:start',
  cancelConversion: 'conversion:cancel',
  conversionUpdate: 'conversion:update',
  getConversionHistory: 'history:list',
  clearConversionHistory: 'history:clear',
  historyUpdated: 'history:updated',
  openHistoryOutput: 'shell:open-history-output',
  showHistoryOutputInFolder: 'shell:show-history-output-in-folder',
  openOutputFile: 'shell:open-output-file',
  showOutputInFolder: 'shell:show-output-in-folder',
  copyText: 'clipboard:write-text',
  openLogDirectory: 'shell:open-log-directory',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
}

export interface DesktopAPI {
  getAppInfo(): Promise<AppInfo>;
  getFfmpegStatus(): Promise<FfmpegStatus>;
  getConversionCapabilities(): Promise<ConversionCapabilities>;
  selectVideos(): Promise<MediaItem[]>;
  importVideos(paths: string[]): Promise<MediaItem[]>;
  /** 由 preload 的 webUtils 获取本地文件路径；不要从 File.path 读取。 */
  getPathForFile(file: File): string;
  selectOutputDirectory(): Promise<string | null>;
  startConversions(request: StartConversionsRequest): Promise<ConversionJob[]>;
  cancelConversion(jobId: string): Promise<void>;
  /** 返回取消订阅函数；组件卸载时必须调用。 */
  onConversionUpdate(callback: (update: ConversionUpdate) => void): () => void;
  getConversionHistory(): Promise<ConversionHistoryEntry[]>;
  clearConversionHistory(): Promise<void>;
  /** 仅由主进程在历史写入成功后推送。 */
  onHistoryUpdated(callback: (entry: ConversionHistoryEntry) => void): () => void;
  openHistoryOutput(historyId: string): Promise<void>;
  showHistoryOutputInFolder(historyId: string): Promise<void>;
  openOutputFile(jobId: string): Promise<void>;
  showOutputInFolder(jobId: string): Promise<void>;
  copyText(text: string): Promise<void>;
  openLogDirectory(): Promise<void>;
}

export const DESKTOP_API_KEYS = [
  'getAppInfo',
  'getFfmpegStatus',
  'getConversionCapabilities',
  'selectVideos',
  'importVideos',
  'getPathForFile',
  'selectOutputDirectory',
  'startConversions',
  'cancelConversion',
  'onConversionUpdate',
  'getConversionHistory',
  'clearConversionHistory',
  'onHistoryUpdated',
  'openHistoryOutput',
  'showHistoryOutputInFolder',
  'openOutputFile',
  'showOutputInFolder',
  'copyText',
  'openLogDirectory',
] as const satisfies readonly (keyof DesktopAPI)[];

export type DesktopApiKey = (typeof DESKTOP_API_KEYS)[number];
