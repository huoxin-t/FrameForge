/**
 * 转换相关共享契约。
 *
 * 这些类型同时被主进程、preload 和 renderer 使用；文件本身不导入
 * Node/Electron 模块，保证 renderer 可以安全引用。
 */

/**
 * 输出 profile 是参数构造、扩展名、能力检测和 UI 文案的唯一来源。
 *
 * videoEncoder/audioEncoder 为 null 表示该 profile 不需要对应的编码器。
 * MP3 的 videoEncoder 必须为 null，避免在参数层意外生成视频轨。
 */
export const OUTPUT_PROFILES = [
  {
    id: 'mp4',
    label: 'MP4',
    extension: 'mp4',
    kind: 'video',
    container: 'MP4',
    probeContainer: 'MP4',
    videoCodec: 'H.264',
    audioCodec: 'AAC',
    videoEncoder: 'libx264',
    audioEncoder: 'aac',
    summary: 'H.264 + AAC',
    description: '兼容性最好，适合分享与常见播放器',
  },
  {
    id: 'mkv',
    label: 'MKV',
    extension: 'mkv',
    kind: 'video',
    container: 'Matroska',
    probeContainer: 'MKV',
    videoCodec: 'H.264',
    audioCodec: 'AAC',
    videoEncoder: 'libx264',
    audioEncoder: 'aac',
    summary: 'H.264 + AAC',
    description: '开放容器，适合保留多轨或后续处理',
  },
  {
    id: 'webm',
    label: 'WebM',
    extension: 'webm',
    kind: 'video',
    container: 'WebM',
    probeContainer: 'WebM',
    videoCodec: 'VP9',
    audioCodec: 'Opus',
    videoEncoder: 'libvpx-vp9',
    audioEncoder: 'libopus',
    summary: 'VP9 + Opus',
    description: '开放网络格式，体积较小；适合网页和现代播放器',
  },
  {
    id: 'mp3',
    label: 'MP3',
    extension: 'mp3',
    kind: 'audio',
    container: 'MP3',
    probeContainer: 'MP3',
    videoCodec: null,
    audioCodec: 'MP3',
    videoEncoder: null,
    audioEncoder: 'libmp3lame',
    summary: '仅音频',
    description: '只导出音频，不保留视频轨道；适合播客或音乐',
  },
] as const;

export type OutputFormat = (typeof OUTPUT_PROFILES)[number]['id'];
export type OutputProfile = (typeof OUTPUT_PROFILES)[number];
export type OutputFormatOption = OutputProfile;

/** 兼容旧调用方：OUTPUT_FORMATS 现在就是完整 profile 列表。 */
export const OUTPUT_FORMATS = OUTPUT_PROFILES;

/**
 * 同一套质量预设按 profile 映射到不同编码参数：
 * - H.264 使用 CRF 23/20/28；
 * - VP9 使用更高的 CRF 32/28/36；
 * - 音频使用 192/256/128 kbps。
 */
export const QUALITY_PRESETS = [
  {
    id: 'compatible',
    label: '兼容优先',
    description: 'H.264 CRF 23 · VP9 CRF 32 · 音频 192 kbps',
    crf: 23,
    vp9Crf: 32,
    audioBitrateKbps: 192,
  },
  {
    id: 'quality',
    label: '质量优先',
    description: 'H.264 CRF 20 · VP9 CRF 28 · 音频 256 kbps',
    crf: 20,
    vp9Crf: 28,
    audioBitrateKbps: 256,
  },
  {
    id: 'compact',
    label: '体积优先',
    description: 'H.264 CRF 28 · VP9 CRF 36 · 音频 128 kbps',
    crf: 28,
    vp9Crf: 36,
    audioBitrateKbps: 128,
  },
] as const;

export type QualityPresetId = (typeof QUALITY_PRESETS)[number]['id'];
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

export interface ConversionSettings {
  format: OutputFormat;
  qualityPreset: QualityPresetId;
  outputDirectory: string;
}

export type ConversionJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface ConversionJob {
  id: string;
  sourcePath: string;
  fileName: string;
  outputPath: string;
  status: ConversionJobStatus;
  /** 0–100。只有真实成功退出并验证输出文件后才允许 100。 */
  progress: number;
  error: string | null;
  logExcerpt: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface StartConversionsRequest {
  sourcePaths: string[];
  settings: ConversionSettings;
}

export interface ConversionUpdate {
  job: ConversionJob;
}

export function isOutputFormat(value: unknown): value is OutputFormat {
  return OUTPUT_PROFILES.some((format) => format.id === value);
}

export function isQualityPresetId(value: unknown): value is QualityPresetId {
  return QUALITY_PRESETS.some((preset) => preset.id === value);
}

export function getOutputFormat(format: OutputFormat): OutputProfile {
  return OUTPUT_PROFILES.find((item) => item.id === format) ?? OUTPUT_PROFILES[0];
}

export function getQualityPreset(id: QualityPresetId): QualityPreset {
  return QUALITY_PRESETS.find((preset) => preset.id === id) ?? QUALITY_PRESETS[0];
}

export function isAudioOnlyFormat(format: OutputFormat): boolean {
  return getOutputFormat(format).kind === 'audio';
}
