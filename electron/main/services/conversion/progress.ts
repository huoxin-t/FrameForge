/**
 * FFmpeg `-progress pipe:1` 进度解析。
 *
 * FFmpeg 的 out_time_us 和 out_time_ms 都以微秒计（后者名称有历史歧义），
 * 因此这里统一按微秒换算为毫秒。转换成功前进度最多 99%，100% 只能由
 * 队列在退出码成功且输出文件验证通过后设置。
 *
 * speed 只来自 FFmpeg 的真实 `speed=1.23x`；未知时保持 null，绝不猜倒计时。
 */
export interface ParsedProgressLine {
  outTimeMs: number | null;
  speed: number | null;
  ended: boolean;
  progressTick: boolean;
}

export interface ProgressTelemetry {
  outTimeMs: number;
  /** 最近几个真实 speed 样本的平均值；样本不足时为 null。 */
  speed: number | null;
  etaSeconds: number | null;
}

export function parseProgressLine(line: string): ParsedProgressLine {
  const normalized = line.trim();
  const separator = normalized.indexOf('=');
  if (separator <= 0) {
    return { outTimeMs: null, speed: null, ended: false, progressTick: false };
  }

  const key = normalized.slice(0, separator).trim();
  const value = normalized.slice(separator + 1).trim();

  if (key === 'progress') {
    return {
      outTimeMs: null,
      speed: null,
      ended: value === 'end',
      progressTick: true,
    };
  }

  if (key === 'out_time_us' || key === 'out_time_ms') {
    const microseconds = Number(value);
    return {
      outTimeMs:
        Number.isFinite(microseconds) && microseconds >= 0
          ? microseconds / 1000
          : null,
      speed: null,
      ended: false,
      progressTick: false,
    };
  }

  if (key === 'out_time') {
    return {
      outTimeMs: parseTimecodeToMs(value),
      speed: null,
      ended: false,
      progressTick: false,
    };
  }

  if (key === 'speed') {
    return {
      outTimeMs: null,
      speed: parseSpeed(value),
      ended: false,
      progressTick: false,
    };
  }

  return { outTimeMs: null, speed: null, ended: false, progressTick: false };
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

/** 只接受 `1.23x` 这种真实 speed 格式；N/A 和非法值返回 null。 */
export function parseSpeed(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?)x$/);
  if (!match) {
    return null;
  }
  const speed = Number(match[1]);
  return Number.isFinite(speed) && speed > 0 ? speed : null;
}

/** 用最近几个 speed 样本平滑，样本不足两个时不展示 ETA。 */
export class SpeedEstimator {
  private readonly samples: number[] = [];

  constructor(private readonly windowSize = 5) {}

  add(speed: number): number | null {
    if (!Number.isFinite(speed) || speed <= 0) {
      return this.current();
    }

    this.samples.push(speed);
    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }
    return this.current();
  }

  current(): number | null {
    if (this.samples.length < 2) {
      return null;
    }
    const total = this.samples.reduce((sum, value) => sum + value, 0);
    return total / this.samples.length;
  }
}

/** 有状态解析器，处理 stdout chunk 跨行的情况。 */
export class FfmpegProgressParser {
  private buffer = '';
  private lastProgress = -1;
  private currentOutTimeMs: number | null = null;
  private readonly speeds = new SpeedEstimator();

  constructor(
    private readonly durationMs: number | null,
    private readonly onProgress: (
      progress: number,
      telemetry?: ProgressTelemetry,
    ) => void,
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

    if (parsed.outTimeMs !== null) {
      this.currentOutTimeMs = parsed.outTimeMs;
      return;
    }

    if (parsed.speed !== null) {
      this.speeds.add(parsed.speed);
      return;
    }

    if (!parsed.progressTick) {
      return;
    }

    if (
      this.currentOutTimeMs === null ||
      !this.durationMs ||
      this.durationMs <= 0
    ) {
      return;
    }

    const progress = Math.max(
      0,
      Math.min(99, Math.floor((this.currentOutTimeMs / this.durationMs) * 100)),
    );

    if (progress <= this.lastProgress) {
      return;
    }

    this.lastProgress = progress;
    const speed = this.speeds.current();
    const remainingMs = Math.max(0, this.durationMs - this.currentOutTimeMs);
    const etaSeconds =
      speed !== null && speed > 0
        ? Math.ceil(remainingMs / 1000 / speed)
        : null;

    this.onProgress(progress, {
      outTimeMs: this.currentOutTimeMs,
      speed,
      etaSeconds,
    });
  }
}
