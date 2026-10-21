/**
 * 媒体导入编排服务。
 *
 * 对每个文件独立执行“元数据探测 → 缩略图抽取”：
 * - 元数据失败：该文件标记为 error，不影响同批其他文件；
 * - 缩略图失败：只写入 thumbnailError，保留元数据，UI 显示占位图；
 * - 每个子步骤都记录真实日志。
 */
import { basename } from 'node:path';
import type { MediaItem, MediaMetadata, MediaThumbnail } from '../../../../shared/media';
import { createLogger } from '../logger';
import type { FfmpegService } from '../ffmpeg/status';
import { probeMedia } from './probe';
import { extractThumbnail } from './thumbnail';

const logger = createLogger('media-service');

export interface MediaServiceDependencies {
  probe: (filePath: string) => Promise<MediaMetadata>;
  extractThumbnail: (metadata: MediaMetadata) => Promise<MediaThumbnail>;
}

export class MediaService {
  private readonly dependencies: MediaServiceDependencies;

  constructor(dependencies: MediaServiceDependencies) {
    this.dependencies = dependencies;
  }

  async importFiles(paths: string[]): Promise<MediaItem[]> {
    const startedAt = Date.now();
    logger.info('Media import started', { count: paths.length });

    const items: MediaItem[] = [];

    for (const filePath of paths) {
      const fileName = basename(filePath) || filePath;
      logger.info('Importing media file', { filePath });

      try {
        const metadata = await this.dependencies.probe(filePath);
        let thumbnailDataUrl: string | null = null;
        let thumbnailError: string | null = null;

        try {
          const thumbnail = await this.dependencies.extractThumbnail(metadata);
          thumbnailDataUrl = thumbnail.dataUrl;
        } catch (error) {
          thumbnailError = toErrorMessage(error);
          logger.warn('Thumbnail failed; keeping media item usable', {
            filePath,
            error,
          });
        }

        items.push({
          path: metadata.path,
          fileName: metadata.fileName,
          metadata,
          thumbnailDataUrl,
          thumbnailError,
          error: null,
        });

        logger.info('Media file imported', {
          filePath,
          hasAudio: metadata.hasAudio,
          hasThumbnail: Boolean(thumbnailDataUrl),
          durationMs: metadata.durationMs,
        });
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        logger.warn('Media file import failed', { filePath, error });
        items.push({
          path: filePath,
          fileName,
          metadata: null,
          thumbnailDataUrl: null,
          thumbnailError: null,
          error: errorMessage,
        });
      }
    }

    logger.info('Media import finished', {
      requested: paths.length,
      succeeded: items.filter((item) => item.error === null).length,
      failed: items.filter((item) => item.error !== null).length,
      elapsedMs: Date.now() - startedAt,
    });

    return items;
  }
}

/** 用真实 FFmpeg 服务构造媒体导入服务。 */
export function createMediaService(
  ffmpeg: Pick<FfmpegService, 'getStatus'>,
): MediaService {
  return new MediaService({
    probe: async (filePath) => {
      const status = await ffmpeg.getStatus();
      if (!status.available || !status.ffprobePath) {
        throw new Error(status.error ?? 'FFmpeg 未就绪，无法读取媒体信息');
      }

      return probeMedia(status.ffprobePath, filePath);
    },
    extractThumbnail: async (metadata) => {
      const status = await ffmpeg.getStatus();
      if (!status.available || !status.ffmpegPath) {
        throw new Error(status.error ?? 'FFmpeg 未就绪，无法生成缩略图');
      }

      return extractThumbnail(status.ffmpegPath, metadata.path, {
        durationMs: metadata.durationMs,
      });
    },
  });
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '未知错误';
}
