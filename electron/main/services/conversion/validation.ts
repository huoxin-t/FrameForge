/**
 * IPC 输入校验。
 *
 * Renderer 不是可信边界：转换请求必须限制为已知格式/预设、绝对目录和
 * 有限数量的字符串路径。真正的文件存在性与媒体合法性由队列/FFprobe 再验证。
 */
import { isAbsolute } from 'node:path';
import {
  isOutputFormat,
  isQualityPresetId,
  type StartConversionsRequest,
} from '../../../../shared/conversion';

export class ConversionRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionRequestError';
  }
}

export function parseStartConversionsRequest(
  value: unknown,
): StartConversionsRequest {
  if (!isRecord(value)) {
    throw new ConversionRequestError('转换请求格式无效');
  }

  if (!Array.isArray(value.sourcePaths) || value.sourcePaths.length === 0) {
    throw new ConversionRequestError('请先导入至少一个视频');
  }

  if (value.sourcePaths.length > 100) {
    throw new ConversionRequestError('一次最多转换 100 个视频');
  }

  const sourcePaths = value.sourcePaths.map((path) => {
    if (typeof path !== 'string' || !path.trim() || !isAbsolute(path.trim())) {
      throw new ConversionRequestError('视频路径必须是绝对路径');
    }
    return path.trim();
  });

  if (!isRecord(value.settings)) {
    throw new ConversionRequestError('转换设置无效');
  }

  const { format, qualityPreset, outputDirectory } = value.settings;

  if (!isOutputFormat(format)) {
    throw new ConversionRequestError('不支持的输出格式');
  }

  if (!isQualityPresetId(qualityPreset)) {
    throw new ConversionRequestError('不支持的质量预设');
  }

  if (
    typeof outputDirectory !== 'string' ||
    !outputDirectory.trim() ||
    !isAbsolute(outputDirectory.trim())
  ) {
    throw new ConversionRequestError('输出目录必须是绝对路径');
  }

  return {
    sourcePaths,
    settings: {
      format,
      qualityPreset,
      outputDirectory: outputDirectory.trim(),
    },
  };
}

export function parseJobId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new ConversionRequestError('任务 ID 无效');
  }
  return value.trim();
}

export const MAX_CLIPBOARD_TEXT_LENGTH = 20_000;

/** 只允许复制有限长度的普通文本，避免 renderer 传入异常大对象。 */
export function parseClipboardText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConversionRequestError('复制内容不能为空');
  }

  if (value.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    throw new ConversionRequestError('复制内容过长');
  }

  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
