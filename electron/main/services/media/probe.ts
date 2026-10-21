/**
 * FFprobe 元数据服务。
 *
 * 负责路径校验、ffprobe 参数构造、JSON 解析和真实进程调用。
 * React 页面不接触这些逻辑；主进程通过受控 IPC 返回结构化结果。
 */
import { constants } from 'node:fs';
import { access as fsAccess, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import { VIDEO_EXTENSIONS, type MediaMetadata } from '../../../../shared/media';
import { createLogger } from '../logger';
import { ProcessError, runProcess, type RunProcess } from '../ffmpeg/process';

const logger = createLogger('media-probe');

export interface ProbeDependencies {
  runProcess?: RunProcess;
}

export class MediaProbeError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'MediaProbeError';
    this.detail = detail;
  }
}

export type VideoPathValidation =
  | { ok: true; path: string; fileSizeBytes: number }
  | { ok: false; error: string };

/**
 * 校验来自文件选择器或导入请求的路径。
 * 只接受绝对路径、受支持的视频扩展名、真实存在且可读的普通文件。
 */
export async function validateVideoPath(filePath: string): Promise<VideoPathValidation> {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: '文件路径为空' };
  }

  const trimmed = filePath.trim();
  if (!isAbsolute(trimmed)) {
    return { ok: false, error: '文件路径必须是绝对路径' };
  }

  try {
    const fileStat = await stat(trimmed);
    if (!fileStat.isFile()) {
      return { ok: false, error: '路径不是文件（可能是目录）' };
    }

    const extension = extname(trimmed).slice(1).toLowerCase();
    if (!(VIDEO_EXTENSIONS as readonly string[]).includes(extension)) {
      return {
        ok: false,
        error: extension
          ? `不支持的文件类型：.${extension}`
          : '不支持的文件类型：缺少扩展名',
      };
    }

    await fsAccess(trimmed, constants.R_OK);
    return {
      ok: true,
      path: resolve(trimmed),
      fileSizeBytes: fileStat.size,
    };
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'ENOENT') {
      return { ok: false, error: '文件不存在' };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, error: '文件不可读，请检查权限' };
    }

    return {
      ok: false,
      error: `无法访问文件：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/** ffprobe 参数只通过数组传递，路径中的空格和中文不经过 shell。 */
export function buildFfprobeArgs(filePath: string): string[] {
  return [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-i',
    filePath,
  ];
}

/**
 * 解析 ffprobe JSON。
 *
 * 该函数是纯函数，便于直接测试典型输出、无音轨、未知帧率、缺失时长和坏 JSON。
 */
export function parseFfprobeJson(
  stdout: string,
  filePath: string,
  fileSizeBytes: number,
): MediaMetadata {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new MediaProbeError(
      '无法解析视频元数据：FFprobe 返回的内容不是合法 JSON',
      stdout.slice(0, 300),
    );
  }

  if (!isRecord(parsed)) {
    throw new MediaProbeError('无法解析视频元数据：根节点不是对象');
  }

  const streams = Array.isArray(parsed.streams)
    ? parsed.streams.filter((stream): stream is Record<string, unknown> => isRecord(stream))
    : [];

  const videoStream = streams.find((stream) => {
    if (stream.codec_type !== 'video') {
      return false;
    }
    const disposition = isRecord(stream.disposition) ? stream.disposition : {};
    return disposition.attached_pic !== 1;
  });

  if (!videoStream) {
    throw new MediaProbeError('文件中没有视频轨道');
  }

  const format = isRecord(parsed.format) ? parsed.format : {};
  const durationSeconds =
    parsePositiveNumber(format.duration) ?? parsePositiveNumber(videoStream.duration);
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  const width = parsePositiveInteger(videoStream.width);
  const height = parsePositiveInteger(videoStream.height);
  const frameRate =
    parseFrameRate(asString(videoStream.r_frame_rate)) ??
    parseFrameRate(asString(videoStream.avg_frame_rate));

  return {
    path: filePath,
    fileName: basename(filePath),
    durationMs:
      durationSeconds === null ? null : Math.round(durationSeconds * 1000),
    width,
    height,
    frameRate,
    containerFormat: detectContainer(asString(format.format_name), filePath),
    videoCodec: normalizeVideoCodec(asString(videoStream.codec_name)),
    audioCodec: audioStream
      ? normalizeAudioCodec(asString(audioStream.codec_name))
      : null,
    hasAudio: Boolean(audioStream),
    fileSizeBytes,
  };
}

/** 调用真实 ffprobe；错误统一转换为普通用户可读的 MediaProbeError。 */
export async function probeMedia(
  ffprobePath: string,
  filePath: string,
  dependencies: ProbeDependencies = {},
): Promise<MediaMetadata> {
  const validation = await validateVideoPath(filePath);
  if (!validation.ok) {
    throw new MediaProbeError(validation.error);
  }

  const startedAt = Date.now();
  logger.info('Probing media file', { filePath: validation.path });

  try {
    const result = await (dependencies.runProcess ?? runProcess)({
      executable: ffprobePath,
      args: buildFfprobeArgs(validation.path),
      timeoutMs: 30000,
    });

    if (result.exitCode !== 0) {
      throw new ProcessError(
        `ffprobe 退出码 ${result.exitCode}`,
        result.exitCode,
        result.stderr,
      );
    }

    const metadata = parseFfprobeJson(
      result.stdout,
      validation.path,
      validation.fileSizeBytes,
    );

    logger.info('Media probe finished', {
      filePath: validation.path,
      durationMs: metadata.durationMs,
      resolution: `${metadata.width ?? '?'}x${metadata.height ?? '?'}`,
      frameRate: metadata.frameRate,
      elapsedMs: Date.now() - startedAt,
    });
    return metadata;
  } catch (error) {
    if (error instanceof MediaProbeError) {
      logger.warn('Media probe failed', { filePath: validation.path, error });
      throw error;
    }

    const detail =
      error instanceof ProcessError
        ? error.stderr
        : error instanceof Error
          ? error.message
          : '';
    const cleanDetail = cleanErrorDetail(detail);

    logger.warn('Media probe failed', {
      filePath: validation.path,
      error,
      elapsedMs: Date.now() - startedAt,
    });
    throw new MediaProbeError(
      `无法读取视频：${cleanDetail || 'FFprobe 执行失败'}`,
      detail,
    );
  }
}

export function parseFrameRate(value: string | null | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === 'N/A' || trimmed === '0/0') {
    return null;
  }

  const [numeratorText, denominatorText] = trimmed.split('/');
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return null;
  }

  return Math.round((numerator / denominator) * 1000) / 1000;
}

function detectContainer(
  formatName: string | null,
  filePath: string,
): string | null {
  const normalized = (formatName ?? '').toLowerCase();
  const extension = extname(filePath).slice(1).toLowerCase();

  if (normalized.includes('mp4')) {
    return 'MP4';
  }
  if (normalized.includes('matroska')) {
    return extension === 'webm' ? 'WebM' : 'MKV';
  }
  if (normalized.includes('webm')) {
    return 'WebM';
  }
  if (normalized.includes('avi')) {
    return 'AVI';
  }
  if (normalized.includes('mov')) {
    return 'MOV';
  }
  if (normalized.includes('mpegts')) {
    return 'MPEG-TS';
  }
  if (normalized.includes('flv')) {
    return 'FLV';
  }
  if (normalized.includes('asf')) {
    return 'WMV';
  }
  if (normalized.includes('ogg')) {
    return 'OGG';
  }

  const first = normalized.split(',')[0]?.trim();
  if (first) {
    return first.toUpperCase();
  }

  return extension ? extension.toUpperCase() : null;
}

function normalizeVideoCodec(codec: string | null): string | null {
  if (!codec) {
    return null;
  }

  const known: Record<string, string> = {
    h264: 'H.264',
    hevc: 'H.265/HEVC',
    h265: 'H.265/HEVC',
    vp8: 'VP8',
    vp9: 'VP9',
    av1: 'AV1',
    mpeg4: 'MPEG-4',
    mpeg2video: 'MPEG-2',
    prores: 'ProRes',
    theora: 'Theora',
    mjpeg: 'MJPEG',
  };

  return known[codec.toLowerCase()] ?? codec.toUpperCase();
}

function normalizeAudioCodec(codec: string | null): string | null {
  if (!codec) {
    return null;
  }

  const known: Record<string, string> = {
    aac: 'AAC',
    mp3: 'MP3',
    opus: 'Opus',
    ac3: 'AC-3',
    eac3: 'E-AC-3',
    flac: 'FLAC',
    vorbis: 'Vorbis',
    pcm_s16le: 'PCM 16-bit',
    pcm_s24le: 'PCM 24-bit',
  };

  return known[codec.toLowerCase()] ?? codec.toUpperCase();
}

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = parsePositiveNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function cleanErrorDetail(detail: string): string {
  const cleaned = detail.replace(/\s+/g, ' ').trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;
}
