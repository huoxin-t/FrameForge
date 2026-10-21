export interface LogTransport {
  debug(...params: unknown[]): void;
  info(...params: unknown[]): void;
  warn(...params: unknown[]): void;
  error(...params: unknown[]): void;
}

export interface ScopedLogger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

export function createScopedLogger(transport: LogTransport, scope: string): ScopedLogger {
  const prefix = `[${scope}]`;

  return {
    debug(message, context) {
      transport.debug(prefix, message, context ?? '');
    },
    info(message, context) {
      transport.info(prefix, message, context ?? '');
    },
    warn(message, context) {
      transport.warn(prefix, message, context ?? '');
    },
    error(message, context) {
      transport.error(prefix, message, context ?? '');
    },
  };
}
