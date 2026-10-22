/**
 * renderer 可安全使用的纯路径字符串工具。
 *
 * 这里不访问文件系统，也不依赖 Node API；输出目录的最终合法性仍由
 * 主进程在入队时验证。
 */

/** 去掉文件名，返回父目录；无法判断时返回 null。 */
export function getParentDirectory(filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return null;
  }

  const lastSeparator = Math.max(
    trimmed.lastIndexOf('\\'),
    trimmed.lastIndexOf('/'),
  );
  if (lastSeparator < 0) {
    return null;
  }

  const directory = trimmed.slice(0, lastSeparator);
  if (!directory) {
    return trimmed.startsWith('/') ? '/' : null;
  }

  if (/^[A-Za-z]:$/.test(directory)) {
    return `${directory}${trimmed[lastSeparator] === '/' ? '/' : '\\'}`;
  }

  return directory.replace(/[\\/]+$/, '') || directory;
}

/** 提取路径最后一段；没有分隔符时原样返回。 */
export function getFileName(filePath: string): string {
  const trimmed = filePath.trim();
  const lastSeparator = Math.max(
    trimmed.lastIndexOf('\\'),
    trimmed.lastIndexOf('/'),
  );
  return lastSeparator >= 0 ? trimmed.slice(lastSeparator + 1) : trimmed;
}
