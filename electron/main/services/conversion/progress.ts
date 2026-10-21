/**
 * FFmpeg `-progress pipe:1` 进度解析。
 *
 * FFmpeg 的 out_time_us 和 out_time_ms 都以微秒计（后者名称有历史歧义），
 * 因此这里统一按微秒换算为毫秒。转换成功前进度最多 99%，100% 只能由
 * 队列在退出码成功且输出文件验证通过后设置。
 */
export interface ParsedProgressLine {
  outTimeMs: number | null;
  ended: boolean;
}

export function parseProgressLine(line: string): ParsedProgressLine {
  const normalized = line.trim();
  const separator = normalized.indexOf('=');
  if (separator <= 0) {
    return { outTimeMs: null, ended: false };
  }

  const key = normalized.slice(0, separator).trim();
  const value = normalized.slice(separator + 1).trim();

  if (key === 'progress') {
    return { outTimeMs: null, ended: value === 'end' };
  }

  if (key === 'out_time_us' || key === 'out_time_ms') {
    const microseconds = Number(value);
    return {
      outTimeMs:
        Number.isFinite(microseconds) && microseconds >= 0
          ? microseconds / 1000
          : null,
      ended: false,
    };
  }

  if (key === 'out_time') {
    return { outTimeMs: parseTimecodeToMs(value), ended: false };
  }

  return { outTimeMs: null, ended: false };
}

export function parseTimecodeToMs(value: string): number | null {
  const match = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    minutes >= 60 ||
    seconds >= 60
  ) {
    return null;
  }

  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/** 有状态解析器，处理 stdout chunk 跨行的情况。 */
export class FfmpegProgressParser {
  private buffer = '';
  private lastProgress = -1;

  constructor(
    private readonly durationMs: number | null,
    private readonly onProgress: (progress: number) => void,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    const parsed = parseProgressLine(line);
    if (parsed.outTimeMs === null || !this.durationMs || this.durationMs <= 0) {
      return;
    }

    const progress = Math.max(
      0,
      Math.min(99, Math.floor((parsed.outTimeMs / this.durationMs) * 100)),
    );

    if (progress > this.lastProgress) {
      this.lastProgress = progress;
      this.onProgress(progress);
    }
  }
}
