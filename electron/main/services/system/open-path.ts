/**
 * 打开一个已存在的本机目录。
 *
 * 仅用于日志目录等由主进程确定的路径；不接收 renderer 的任意路径。
 */
import { isAbsolute } from 'node:path';

export interface OpenExistingDirectoryDependencies {
  openPath: (path: string) => Promise<string>;
  pathExists: (path: string) => Promise<boolean>;
}

export class OpenDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenDirectoryError';
  }
}

export async function openExistingDirectory(
  directory: string,
  dependencies: OpenExistingDirectoryDependencies,
): Promise<void> {
  if (!directory.trim() || !isAbsolute(directory)) {
    throw new OpenDirectoryError('目录路径无效');
  }

  if (!(await dependencies.pathExists(directory))) {
    throw new OpenDirectoryError('目录不存在，无法打开');
  }

  const error = await dependencies.openPath(directory);
  if (error) {
    throw new OpenDirectoryError(`无法打开目录：${error}`);
  }
}
