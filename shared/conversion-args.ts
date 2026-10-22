/**
 * FFmpeg 参数构造与命令预览。
 *
 * 这里是唯一参数来源：主进程用 buildConversionArgs() 真正执行，renderer
 * 用同一个函数生成只读预览。文件不导入 Node/Electron 模块。
 */
import {
  DEFAULT_ADVANCED_SETTINGS,
  getOutputFormat,
  getQualityPreset,
  getResolutionHeight,
  type AdvancedConversionSettings,
  type OutputFormat,
  type QualityPresetId,
} from './conversion';

export interface BuildConversionArgsOptions {
  inputPath: string;
  outputPath: string;
  format: OutputFormat;
  qualityPreset: QualityPresetId;
  /** 是否保留音轨；调用方应已经结合音频模式计算出最终值。 */
  hasAudio: boolean;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  advanced?: AdvancedConversionSettings;
}

export class ConversionArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionArgsError';
  }
}

export function getFormatExtension(format: OutputFormat): string {
  return getOutputFormat(format).extension;
}

/**
 * 构造真实的 FFmpeg 转码命令。
 *
 * `-progress pipe:1` 让主进程从 stdout 读取结构化进度；`-nostats` 关闭
 * stderr 的冗长统计输出。最终临时文件名由调用方负责，且必须以目标扩展名结尾。
 */
export function buildConversionArgs(
  options: BuildConversionArgsOptions,
): string[] {
  const profile = getOutputFormat(options.format);
  const preset = getQualityPreset(options.qualityPreset);
  const advanced = options.advanced ?? DEFAULT_ADVANCED_SETTINGS;
  const audioBitrateKbps =
    advanced.audioBitrateKbps ?? preset.audioBitrateKbps;
  const keepAudio = options.hasAudio && advanced.audioMode !== 'remove';
  const args = ['-hide_banner', '-v', 'error', '-y', '-i', options.inputPath];

  if (profile.kind === 'audio') {
    if (advanced.audioMode === 'remove') {
      throw new ConversionArgsError('MP3 必须保留音轨');
    }
    if (!options.hasAudio) {
      throw new ConversionArgsError('源文件没有音轨，无法导出 MP3');
    }

    args.push(
      '-vn',
      '-map',
      '0:a:0',
      '-c:a',
      profile.audioEncoder,
      '-b:a',
      `${audioBitrateKbps}k`,
    );
  } else {
    args.push('-map', '0:v:0', '-sn');

    if (keepAudio) {
      args.push(
        '-map',
        '0:a:0?',
        '-c:a',
        profile.audioEncoder,
        '-b:a',
        `${audioBitrateKbps}k`,
      );
    } else {
      // 无音轨输入或用户选择移除音轨时必须明确禁用，不凭空造音轨。
      args.push('-an');
    }

    const videoCrf =
      advanced.crf ??
      (profile.id === 'webm' ? preset.vp9Crf : preset.crf);

    args.push(
      '-c:v',
      profile.videoEncoder,
      '-crf',
      String(videoCrf),
      '-pix_fmt',
      'yuv420p',
    );

    const targetHeight = getResolutionHeight(advanced.resolution);
    if (
      targetHeight !== null &&
      options.sourceHeight !== null &&
      options.sourceHeight !== undefined &&
      options.sourceHeight > targetHeight
    ) {
      // -2 保证宽度是偶数；只按高度设上限，绝不放大源视频。
      args.push('-vf', `scale=-2:${targetHeight}:flags=lanczos`);
    }

    if (profile.id === 'mp4' || profile.id === 'mkv') {
      args.push('-preset', 'medium');
    }

    if (profile.id === 'webm') {
      // VP9 恒定质量模式：CRF + 0 目标码率；row-mt 改善多核吞吐。
      args.push(
        '-b:v',
        '0',
        '-deadline',
        'good',
        '-cpu-used',
        '4',
        '-row-mt',
        '1',
      );
    }

    if (profile.id === 'mp4') {
      args.push('-movflags', '+faststart');
    }
  }

  // 缩短统计/进度刷新间隔，短视频也能得到中间的 out_time 更新。
  args.push(
    '-stats_period',
    '0.2',
    '-progress',
    'pipe:1',
    '-nostats',
    options.outputPath,
  );
  return args;
}

/** 把参数数组格式化成可复制、可阅读的命令行；不用于实际执行。 */
export function formatCommandForDisplay(
  executablePath: string,
  args: string[],
): string {
  return [executablePath, ...args].map(quoteWindowsArg).join(' ');
}

function quoteWindowsArg(value: string): string {
  if (!/[\s"&|<>^()]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}
