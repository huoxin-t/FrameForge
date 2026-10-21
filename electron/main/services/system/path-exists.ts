import { access } from 'node:fs/promises';

/** 检查路径是否存在；只用于主进程已经掌握的路径。 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
