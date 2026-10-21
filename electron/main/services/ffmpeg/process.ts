/**
 * 受控子进程执行器。
 *
 * 所有 FFmpeg/FFprobe 调用都经过这里：
 * - 使用 spawn(executable, args, { shell: false })；
 * - 参数以数组传入，禁止拼接 shell 字符串；
 * - 统一收集 stdout/stderr、退出码、超时和取消信号；
 * - 统一记录真实日志，便于定位外部进程失败。
 */
import { spawn } from 'node:child_process';
import { createLogger } from '../logger';

const logger = createLogger('process');

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunProcessOptions {
  executable: string;
  args: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 流式读取 stdout，供转换进度解析使用；普通探测不传即可。 */
  onStdout?: (chunk: string) => void;
}

export type RunProcess = (options: RunProcessOptions) => Promise<ProcessResult>;

export class ProcessError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly code?: string;

  constructor(
    message: string,
    exitCode: number | null,
    stderr = '',
    code?: string,
  ) {
    super(message);
    this.name = 'ProcessError';
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.code = code;
  }
}

export const runProcess: RunProcess = (options) => {
  const startedAt = Date.now();
  logger.debug('Starting process', {
    executable: options.executable,
    args: options.args,
    timeoutMs: options.timeoutMs ?? null,
  });

  return new Promise<ProcessResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(options.executable, options.args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const message = `无法启动进程：${options.executable}`;
      logger.error('Failed to spawn process', {
        executable: options.executable,
        error,
      });
      reject(new ProcessError(message, null, '', getErrorCode(error)));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let timeout: NodeJS.Timeout | undefined;
    let abortFallback: NodeJS.Timeout | undefined;

    const stdoutText = () => Buffer.concat(stdoutChunks).toString('utf8');
    const stderrText = () => Buffer.concat(stderrChunks).toString('utf8');

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (abortFallback) {
        clearTimeout(abortFallback);
      }
      options.signal?.removeEventListener('abort', onAbort);
    };

    const finish = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      action();
    };

    const fail = (message: string, exitCode: number | null, code?: string) => {
      const stderr = stderrText();
      logger.error('Process failed', {
        executable: options.executable,
        exitCode,
        elapsedMs: Date.now() - startedAt,
        code: code ?? null,
        stderr: stderr.slice(0, 2000),
      });
      finish(() => reject(new ProcessError(message, exitCode, stderr, code)));
    };

    const onAbort = () => {
      if (settled || aborted) {
        return;
      }

      aborted = true;
      logger.info('Canceling process', {
        executable: options.executable,
        elapsedMs: Date.now() - startedAt,
      });
      child.kill();

      // 等 close 事件确认进程已经退出；若子进程没有响应，兜底结束等待。
      abortFallback = setTimeout(() => {
        fail('进程已取消', null, 'ABORTED');
      }, 3000);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (options.onStdout) {
        try {
          options.onStdout(chunk.toString('utf8'));
        } catch (error) {
          logger.warn('stdout callback failed', { error });
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (aborted) {
        fail('进程已取消', null, 'ABORTED');
        return;
      }
      fail(`无法启动进程：${options.executable}`, null, error.code);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      if (aborted) {
        fail('进程已取消', code, 'ABORTED');
        return;
      }

      if (timedOut) {
        fail(`进程执行超时：${options.executable}`, code, 'TIMEOUT');
        return;
      }

      if (code === 0) {
        logger.info('Process finished', {
          executable: options.executable,
          exitCode: code,
          elapsedMs: Date.now() - startedAt,
        });
        finish(() =>
          resolve({
            stdout: stdoutText(),
            stderr: stderrText(),
            exitCode: 0,
          }),
        );
        return;
      }

      const stderr = stderrText();
      finish(() =>
        reject(
          new ProcessError(
            `进程退出码 ${code ?? 'unknown'}：${options.executable}`,
            code,
            stderr,
          ),
        ),
      );
      logger.error('Process exited with non-zero code', {
        executable: options.executable,
        exitCode: code,
        elapsedMs: Date.now() - startedAt,
        stderr: stderr.slice(0, 2000),
      });
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs);
    }

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
};

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
