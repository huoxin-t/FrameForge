/**
 * IPC 输入校验。
 *
 * Renderer 不是可信边界：转换请求必须限制为已知格式/预设、绝对目录和
 * 有限数量的字符串路径。真正的文件存在性与媒体合法性由队列/FFprobe 再验证。
 */
import { isAbsolute } from 'node:path';
import {
  DEFAULT_ADVANCED_SETTINGS,
  isAudioBitrateKbps,
  isAudioMode,
  isAudioOnlyFormat,
  isCrfInRange,
  isOutputFormat,
  isQualityPresetId,
  isResolutionPresetId,
  type AdvancedConversionSettings,
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

  const { format, qualityPreset, outputDirectory, advanced } = value.settings;

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

  const parsedAdvanced = parseAdvancedSettings(advanced);
  if (isAudioOnlyFormat(format) && parsedAdvanced.audioMode === 'remove') {
    throw new ConversionRequestError('MP3 必须保留音轨');
  }

  return {
    sourcePaths,
    settings: {
      format,
      qualityPreset,
      outputDirectory: outputDirectory.trim(),
      advanced: parsedAdvanced,
    },
  };
}

/** 高级设置允许整体省略（旧请求/测试），但显式字段必须合法。 */
function parseAdvancedSettings(value: unknown): AdvancedConversionSettings {
  if (value === undefined) {
    return { ...DEFAULT_ADVANCED_SETTINGS };
  }
  if (!isRecord(value)) {
    throw new ConversionRequestError('高级设置格式无效');
  }

  const resolution = value.resolution ?? DEFAULT_ADVANCED_SETTINGS.resolution;
  if (!isResolutionPresetId(resolution)) {
    throw new ConversionRequestError('不支持的分辨率');
  }

  const audioBitrateKbps =
    value.audioBitrateKbps ?? DEFAULT_ADVANCED_SETTINGS.audioBitrateKbps;
  if (audioBitrateKbps !== null && !isAudioBitrateKbps(audioBitrateKbps)) {
    throw new ConversionRequestError('不支持的音频码率');
  }

  const crf = value.crf ?? DEFAULT_ADVANCED_SETTINGS.crf;
  if (crf !== null && !isCrfInRange(crf)) {
    throw new ConversionRequestError('CRF 必须是 18 到 30 的整数');
  }

  const audioMode = value.audioMode ?? DEFAULT_ADVANCED_SETTINGS.audioMode;
  if (!isAudioMode(audioMode)) {
    throw new ConversionRequestError('不支持的音频模式');
  }

  return {
    resolution,
    audioBitrateKbps,
    crf,
    audioMode,
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
