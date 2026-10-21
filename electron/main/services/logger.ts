import log from 'electron-log/main';
import { createScopedLogger, type ScopedLogger } from './logger-core';

const isDevelopment = process.env.NODE_ENV === 'development';

log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.level = isDevelopment ? 'debug' : 'info';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';
log.errorHandler.startCatching({ showDialog: false });

export type Logger = ScopedLogger;

export function createLogger(scope: string): Logger {
  return createScopedLogger(log, scope);
}

export function getLogFilePath(): string {
  return log.transports.file.getFile().path;
}
