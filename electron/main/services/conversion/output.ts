/**
 * 输出路径与目录安全。
 *
 * 输出永远使用 `_converted` 名称；已有文件或同一队列中已预留的名称会
 * 依次生成 `(1)`、`(2)`，绝不静默覆盖。转换先写入同目录的临时文件，
 * 成功校验后再改名。
 */
import { constants } from 'node:fs';
import { access as fsAccess, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { getOutputFormat, type OutputFormat } from '../../../../shared/conversion';

export type OutputDirectoryValidation =
  | { ok: true; path: string }
  | { ok: false; error: string };

export function getOutputBaseName(sourceFileName: string): string {
  const name = basename(sourceFileName, extname(sourceFileName)).trim();
  return name || 'video';
}

/**
 * 生成第 N 个候选输出名。
 *
 * attempt=0 为 `_converted`，attempt>=1 为 `_converted (N)`。
 * 扩展名只由输出格式决定，不沿用输入扩展名。
 */
export function buildOutputPath(
  directory: string,
  sourceFileName: string,
  format: OutputFormat,
  attempt = 0,
): string {
  const base = getOutputBaseName(sourceFileName);
  const suffix = attempt > 0 ? `_converted (${attempt})` : '_converted';
  return join(directory, `${base}${suffix}.${getOutputFormat(format).extension}`);
}

/** 在候选名称中寻找第一个未被占用的路径。 */
export async function findUniqueOutputPath(
  directory: string,
  sourceFileName: string,
  format: OutputFormat,
  isTaken: (candidate: string) => boolean | Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = buildOutputPath(directory, sourceFileName, format, attempt);
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  throw new Error('无法生成不冲突的输出文件名，请更换输出目录');
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsAccess(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** 校验输出目录必须存在、是目录且当前用户可写。 */
export async function validateOutputDirectory(
  directory: string,
): Promise<OutputDirectoryValidation> {
  if (typeof directory !== 'string' || !directory.trim()) {
    return { ok: false, error: '请先选择输出目录' };
  }

  const trimmed = directory.trim();
  if (!isAbsolute(trimmed)) {
    return { ok: false, error: '输出目录必须是绝对路径' };
  }

  try {
    const directoryStat = await stat(trimmed);
    if (!directoryStat.isDirectory()) {
      return { ok: false, error: '输出路径不是目录' };
    }

    await fsAccess(trimmed, constants.W_OK);
    return { ok: true, path: resolve(trimmed) };
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'ENOENT') {
      return { ok: false, error: '输出目录不存在' };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, error: '输出目录不可写，请检查权限' };
    }

    return {
      ok: false,
      error: `无法使用输出目录：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/** 临时文件必须保留目标扩展名，FFmpeg 才能正确选择 muxer。 */
export function buildTemporaryOutputPath(outputPath: string, jobId: string): string {
  const extension = extname(outputPath);
  const base = basename(outputPath, extension);
  return join(
    dirname(outputPath),
    `${base}.part-${jobId.replace(/[^a-zA-Z0-9_-]/g, '')}${extension}`,
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
