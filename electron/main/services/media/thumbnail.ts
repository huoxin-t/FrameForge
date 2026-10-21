/**
 * FFmpeg 缩略图服务。
 *
 * 通过真实 ffmpeg 子进程抽取单帧，输出 320×180 JPEG，再以 data URL
 * 返回给 renderer。缩略图失败属于可降级错误：调用方保留占位图即可。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaThumbnail } from '../../../../shared/media';
import { createLogger } from '../logger';
import { ProcessError, runProcess, type RunProcess } from '../ffmpeg/process';

const logger = createLogger('media-thumbnail');

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 180;
const THUMBNAIL_FILTER =
  'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:color=black';

export interface ThumbnailOptions {
  durationMs?: number | null;
  tempDir?: string;
  runProcess?: RunProcess;
}

export class ThumbnailError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'ThumbnailError';
    this.detail = detail;
  }
}

/**
 * 构造缩略图命令。
 *
 * 2 秒及以上的视频优先在约第 1 秒抽帧；短视频直接从第 0 帧抽取。
 * 所有路径都在 args 数组中，不拼接 shell 字符串。
 */
export function buildThumbnailArgs(
  inputPath: string,
  outputPath: string,
  durationMs: number | null | undefined,
): string[] {
  const args = ['-v', 'error', '-y'];

  if (durationMs !== null && durationMs !== undefined && durationMs >= 2000) {
    args.push('-ss', '1');
  }

  args.push(
    '-i',
    inputPath,
    '-an',
    '-sn',
    '-frames:v',
    '1',
    '-vf',
    THUMBNAIL_FILTER,
    '-q:v',
    '3',
    '-update',
    '1',
    outputPath,
  );

  return args;
}

export async function extractThumbnail(
  ffmpegPath: string,
  inputPath: string,
  options: ThumbnailOptions = {},
): Promise<MediaThumbnail> {
  const run = options.runProcess ?? runProcess;
  const tempDirectory = options.tempDir ?? join(tmpdir(), 'frameforge-thumbnails');
  const outputPath = join(tempDirectory, `thumb-${randomUUID()}.jpg`);
  const startedAt = Date.now();

  await mkdir(tempDirectory, { recursive: true });

  logger.info('Extracting thumbnail', {
    inputPath,
    durationMs: options.durationMs ?? null,
    outputPath,
  });

  try {
    try {
      await run({
        executable: ffmpegPath,
        args: buildThumbnailArgs(inputPath, outputPath, options.durationMs),
        timeoutMs: 30000,
      });
    } catch (error) {
      if (options.durationMs && options.durationMs >= 2000) {
        logger.warn('Thumbnail seek failed; retrying at frame 0', {
          inputPath,
          error,
        });
        await run({
          executable: ffmpegPath,
          args: buildThumbnailArgs(inputPath, outputPath, 0),
          timeoutMs: 30000,
        });
      } else {
        throw error;
      }
    }

    const bytes = await readFile(outputPath);
    if (bytes.length === 0) {
      throw new ThumbnailError('FFmpeg 没有生成有效的缩略图文件');
    }

    logger.info('Thumbnail extracted', {
      inputPath,
      bytes: bytes.length,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
    };
  } catch (error) {
    if (error instanceof ThumbnailError) {
      logger.warn('Thumbnail extraction failed', { inputPath, error });
      throw error;
    }

    const detail =
      error instanceof ProcessError
        ? error.stderr
        : error instanceof Error
          ? error.message
          : '';
    const cleaned = detail.replace(/\s+/g, ' ').trim().slice(0, 300);

    logger.warn('Thumbnail extraction failed', {
      inputPath,
      error,
      elapsedMs: Date.now() - startedAt,
    });
    throw new ThumbnailError(
      `缩略图生成失败：${cleaned || 'FFmpeg 执行失败'}`,
      detail,
    );
  } finally {
    await rm(outputPath, { force: true }).catch(() => {
      logger.debug('Failed to remove temporary thumbnail', { outputPath });
    });
  }
}
