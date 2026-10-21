/**
 * 测试专用日志器。
 *
 * 设计原因：
 * - 测试必须能看出当前执行到哪个用例、哪一步失败，不能只靠 Vitest 的最终红绿结果。
 * - 使用真实的 electron-log，而不是自己写一个假的 console 包装。
 * - 测试日志只输出到控制台，关闭文件传输，避免污染用户真实的
 *   %APPDATA%\frameforge\logs\main.log。
 */
import log from 'electron-log/node';
import { createScopedLogger, type ScopedLogger } from '../../electron/main/services/logger-core';

log.transports.file.level = false;
log.transports.console.level = 'info';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

export function createTestLogger(scope: string): ScopedLogger {
  return createScopedLogger(log, `test:${scope}`);
}
