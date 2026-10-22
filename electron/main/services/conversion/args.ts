/**
 * 转换参数构造。
 *
 * 只通过 spawn 参数数组使用；这里不拼接 shell 字符串。
 * 参数由 OutputProfile 驱动：MP4/MKV 使用 H.264 + AAC，WebM 使用
 * VP9 + Opus，MP3 只构造音频编码。MP4 专属的 faststart 只出现在 MP4。
 */
import {
  getOutputFormat,
  getQualityPreset,
  type OutputFormat,
  type QualityPresetId,
} from '../../../../shared/conversion';

export interface BuildConversionArgsOptions {
  inputPath: string;
  outputPath: string;
  format: OutputFormat;
  qualityPreset: QualityPresetId;
  hasAudio: boolean;
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
export function buildConversionArgs(options: BuildConversionArgsOptions): string[] {
  const profile = getOutputFormat(options.format);
  const preset = getQualityPreset(options.qualityPreset);
  const args = ['-hide_banner', '-v', 'error', '-y', '-i', options.inputPath];

  if (profile.kind === 'audio') {
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
      `${preset.audioBitrateKbps}k`,
    );
  } else {
    args.push('-map', '0:v:0', '-sn');

    if (options.hasAudio) {
      args.push(
        '-map',
        '0:a:0?',
        '-c:a',
        profile.audioEncoder,
        '-b:a',
        `${preset.audioBitrateKbps}k`,
      );
    } else {
      // 无音轨输入必须明确禁用音频，不凭空空造音轨。
      args.push('-an');
    }

    args.push(
      '-c:v',
      profile.videoEncoder,
      '-crf',
      String(profile.id === 'webm' ? preset.vp9Crf : preset.crf),
      '-pix_fmt',
      'yuv420p',
    );

    if (profile.id === 'mp4' || profile.id === 'mkv') {
      args.push('-preset', 'medium');
    }

    if (profile.id === 'webm') {
      // VP9 恒定质量模式：CRF + 0 目标码率；row-mt 改善多核吞吐。
      args.push('-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1');
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
