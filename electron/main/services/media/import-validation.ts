/**
 * 拖拽导入路径校验。
 *
 * Renderer 传来的路径不可信：只接受有限数量、绝对路径、已知视频扩展名，
 * 并按大小写不敏感去重。文件存在性、是否普通文件和媒体合法性仍由
 * MediaService / FFprobe 再做验证。
 */
import { extname, isAbsolute } from 'node:path';
import {
  VIDEO_EXTENSIONS,
  type VideoExtension,
} from '../../../../shared/media';

export const MAX_IMPORT_FILES = 100;

export class ImportPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportPathError';
  }
}

export function parseVideoPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ImportPathError('视频路径必须是路径数组');
  }

  if (value.length === 0) {
    throw new ImportPathError('请至少选择一个视频文件');
  }

  if (value.length > MAX_IMPORT_FILES) {
    throw new ImportPathError('一次最多导入 100 个视频');
  }

  const unique = new Map<string, string>();

  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new ImportPathError('视频路径必须是非空字符串');
    }

    const filePath = item.trim();
    if (!isAbsolute(filePath)) {
      throw new ImportPathError(`视频路径必须是绝对路径：${filePath}`);
    }

    const extension = extname(filePath).slice(1).toLowerCase();
    if (!VIDEO_EXTENSIONS.includes(extension as VideoExtension)) {
      throw new ImportPathError(`不支持的视频格式：${extension || '无扩展名'}`);
    }

    const key = filePath.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, filePath);
    }
  }

  return [...unique.values()];
}
