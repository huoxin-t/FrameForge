/**
 * 转换相关共享契约。
 *
 * 这些类型同时被主进程、preload 和 renderer 使用；文件本身不导入
 * Node/Electron 模块，保证 renderer 可以安全引用。
 */

export const OUTPUT_FORMATS = [
  {
    id: 'mp4',
    label: 'MP4',
    extension: 'mp4',
    description: '兼容性最好，适合分享与常见播放器',
  },
  {
    id: 'mkv',
    label: 'MKV',
    extension: 'mkv',
    description: '开放容器，适合保留多轨或后续处理',
  },
] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]['id'];
export type OutputFormatOption = (typeof OUTPUT_FORMATS)[number];

export const QUALITY_PRESETS = [
  {
    id: 'compatible',
    label: '兼容优先',
    description: 'H.264 + AAC，CRF 23',
    crf: 23,
  },
  {
    id: 'quality',
    label: '质量优先',
    description: 'H.264 + AAC，CRF 20',
    crf: 20,
  },
  {
    id: 'compact',
    label: '体积优先',
    description: 'H.264 + AAC，CRF 28',
    crf: 28,
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
  return OUTPUT_FORMATS.some((format) => format.id === value);
}

export function isQualityPresetId(value: unknown): value is QualityPresetId {
  return QUALITY_PRESETS.some((preset) => preset.id === value);
}

export function getOutputFormat(format: OutputFormat): OutputFormatOption {
  return OUTPUT_FORMATS.find((item) => item.id === format) ?? OUTPUT_FORMATS[0];
}

export function getQualityPreset(id: QualityPresetId): QualityPreset {
  return QUALITY_PRESETS.find((preset) => preset.id === id) ?? QUALITY_PRESETS[0];
}
