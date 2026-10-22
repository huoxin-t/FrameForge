/**
 * FFmpeg 编码器能力契约。
 *
 * 主进程用真实 `ffmpeg -encoders` 输出构造能力矩阵；renderer 只读取
 * 这份矩阵来禁用不可用格式。这里不猜测编码器存在，也不把缺失的
 * 编码器显示成“可以转换”。
 */
import {
  OUTPUT_PROFILES,
  type OutputFormat,
  type OutputProfile,
} from './conversion';

export const ENCODER_IDS = [
  'libx264',
  'aac',
  'libvpx-vp9',
  'libopus',
  'libmp3lame',
] as const;

export type EncoderId = (typeof ENCODER_IDS)[number];
export type EncoderAvailability = Record<EncoderId, boolean>;

export const ALL_ENCODERS_AVAILABLE: EncoderAvailability = {
  libx264: true,
  aac: true,
  'libvpx-vp9': true,
  libopus: true,
  libmp3lame: true,
};

export const NO_ENCODERS_AVAILABLE: EncoderAvailability = {
  libx264: false,
  aac: false,
  'libvpx-vp9': false,
  libopus: false,
  libmp3lame: false,
};

export interface FormatCapability {
  format: OutputFormat;
  available: boolean;
  missingEncoders: EncoderId[];
  reason: string | null;
}

export interface ConversionCapabilities {
  checkedAt: number;
  ffmpegVersion: string | null;
  encoders: EncoderAvailability;
  formats: FormatCapability[];
  error: string | null;
}

export interface BuildCapabilitiesOptions {
  checkedAt?: number;
  ffmpegVersion?: string | null;
  error?: string | null;
}

/**
 * 解析 `ffmpeg -hide_banner -encoders` 的输出。
 *
 * 典型行：` V....D libx264  H.264 / AVC ...`。
 * 只读取编码器名字；找不到时返回全 false，不把未知状态当成可用。
 */
export function parseEncoderList(output: string): EncoderAvailability {
  const found = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/);
    if (match) {
      found.add(match[1]);
    }
  }

  return Object.fromEntries(
    ENCODER_IDS.map((encoder) => [encoder, found.has(encoder)]),
  ) as EncoderAvailability;
}

export function buildConversionCapabilities(
  encoders: EncoderAvailability,
  options: BuildCapabilitiesOptions = {},
): ConversionCapabilities {
  return {
    checkedAt: options.checkedAt ?? Date.now(),
    ffmpegVersion: options.ffmpegVersion ?? null,
    encoders: { ...encoders },
    formats: OUTPUT_PROFILES.map((profile) =>
      buildFormatCapability(profile, encoders),
    ),
    error: options.error ?? null,
  };
}

export function getFormatCapability(
  capabilities: ConversionCapabilities,
  format: OutputFormat,
): FormatCapability {
  return (
    capabilities.formats.find((item) => item.format === format) ?? {
      format,
      available: false,
      missingEncoders: [],
      reason: '没有该格式的能力检测结果',
    }
  );
}

function buildFormatCapability(
  profile: OutputProfile,
  encoders: EncoderAvailability,
): FormatCapability {
  const missingEncoders = getRequiredEncoders(profile).filter(
    (encoder) => !encoders[encoder],
  );

  return {
    format: profile.id,
    available: missingEncoders.length === 0,
    missingEncoders,
    reason:
      missingEncoders.length > 0
        ? `缺少编码器：${missingEncoders.join('、')}`
        : null,
  };
}

function getRequiredEncoders(profile: OutputProfile): EncoderId[] {
  return [profile.videoEncoder, profile.audioEncoder].filter(
    (encoder): encoder is EncoderId => encoder !== null,
  );
}
