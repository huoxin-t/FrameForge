/**
 * 媒体相关共享契约。
 *
 * 这些类型同时被主进程、preload 和 renderer 使用。
 * 这里不导入任何 Node/Electron 模块，保证 renderer 可以安全引用。
 */

export const VIDEO_EXTENSIONS = [
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'avi',
  'wmv',
  'flv',
  'mpg',
  'mpeg',
  'ts',
  'm2ts',
  '3gp',
] as const;

export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number];

export interface MediaMetadata {
  /** 绝对路径，来自系统文件选择器或经过校验的导入请求。 */
  path: string;
  fileName: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  containerFormat: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  fileSizeBytes: number;
}

export interface MediaThumbnail {
  dataUrl: string;
  width: number;
  height: number;
}

export interface MediaItem {
  path: string;
  fileName: string;
  metadata: MediaMetadata | null;
  thumbnailDataUrl: string | null;
  thumbnailError: string | null;
  /** 元数据读取失败时，整个文件不可用；缩略图失败只写入 thumbnailError。 */
  error: string | null;
}

export type FfmpegSource = 'environment' | 'bundled' | 'system';

export interface FfmpegStatus {
  available: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  version: string | null;
  ffprobeVersion: string | null;
  source: FfmpegSource | null;
  error: string | null;
}
