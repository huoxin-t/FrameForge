/**
 * 转换参数构造。
 *
 * 只通过 spawn 参数数组使用；这里不拼接 shell 字符串。
 * MP4/MKV 共用 H.264 + AAC 预设，但 MP4 专属的 faststart 只出现在 MP4。
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
  const preset = getQualityPreset(options.qualityPreset);
  const args = [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-i',
    options.inputPath,
    '-map',
    '0:v:0',
    '-sn',
  ];

  if (options.hasAudio) {
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k');
  } else {
    // 无音轨输入必须明确禁用音频，不凭空空造音轨。
    args.push('-an');
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    String(preset.crf),
    '-pix_fmt',
    'yuv420p',
  );

  if (options.format === 'mp4') {
    args.push('-movflags', '+faststart');
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
