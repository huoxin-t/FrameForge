#!/usr/bin/env node
/**
 * 准备随包 FFmpeg。
 *
 * 输入：
 * - FRAMEFORGE_FFMPEG_SOURCE 或 FRAMEFORGE_FFMPEG_DIR 指向 bin 目录/安装根目录；
 * - 或者从系统 PATH 查找 ffmpeg/ffprobe。
 *
 * 输出：
 * - resources/ffmpeg/<platform>-<arch>/ffmpeg(.exe)
 * - resources/ffmpeg/<platform>-<arch>/ffprobe(.exe)
 * - Windows shared build 需要的 DLL
 * - LICENSE / README（如果源目录提供）
 * - bundle-manifest.json（真实版本与文件清单）
 *
 * 脚本只复制和验证，不伪造版本；所有版本检查都通过 spawn(executable, args, { shell: false })。
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetPlatform = process.platform;
const targetArch = process.arch;
const executableSuffix = targetPlatform === 'win32' ? '.exe' : '';
const ffmpegName = `ffmpeg${executableSuffix}`;
const ffprobeName = `ffprobe${executableSuffix}`;

async function main() {
  const explicitSource =
    process.env.FRAMEFORGE_FFMPEG_SOURCE ?? process.env.FRAMEFORGE_FFMPEG_DIR;
  const sourceDirectory = await resolveSourceDirectory(explicitSource);
  const targetDirectory = getTargetDirectory();

  await prepareBundle(sourceDirectory, targetDirectory);
  const versions = await verifyBundle(targetDirectory);
  await writeManifest(sourceDirectory, targetDirectory, versions);

  console.log(`[ffmpeg] bundle ready: ${targetDirectory}`);
  console.log(`[ffmpeg] ${versions.ffmpegVersion}`);
  console.log(`[ffmpeg] ${versions.ffprobeVersion}`);
}

/** 当前平台的随包目录。 */
function getTargetDirectory() {
  return join(projectRoot, 'resources', 'ffmpeg', `${targetPlatform}-${targetArch}`);
}

/** Windows PATH 条目偶尔带引号，先去掉成对引号。 */
function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** 从显式目录或 PATH 找到一个同时包含 ffmpeg/ffprobe 的目录。 */
async function resolveSourceDirectory(explicitSource) {
  const candidates = [];

  if (explicitSource) {
    const normalized = stripQuotes(explicitSource.trim());
    candidates.push(normalized, join(normalized, 'bin'));
  }

  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  for (const entry of pathValue.split(delimiter)) {
    if (entry.trim()) {
      candidates.push(stripQuotes(entry.trim()));
    }
  }

  for (const directory of candidates) {
    if (await hasCompletePair(directory)) {
      return directory;
    }
  }

  throw new Error(
    '未找到 FFmpeg/FFprobe。请设置 FRAMEFORGE_FFMPEG_SOURCE 指向包含 ffmpeg 与 ffprobe 的目录，或把 FFmpeg 加入 PATH。',
  );
}

async function hasCompletePair(directory) {
  const [hasFfmpeg, hasFfprobe] = await Promise.all([
    isFile(join(directory, ffmpegName)),
    isFile(join(directory, ffprobeName)),
  ]);
  return hasFfmpeg && hasFfprobe;
}

async function isFile(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

/** 复制 exe、Windows DLL 和许可证文件；目标目录每次重建，避免残留旧版本。 */
async function prepareBundle(sourceDirectory, targetDirectory) {
  await rm(targetDirectory, { recursive: true, force: true });
  await mkdir(targetDirectory, { recursive: true });

  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  const files = new Map([
    [ffmpegName, join(sourceDirectory, ffmpegName)],
    [ffprobeName, join(sourceDirectory, ffprobeName)],
  ]);

  if (targetPlatform === 'win32') {
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll')) {
        files.set(entry.name, join(sourceDirectory, entry.name));
      }
    }
  }

  for (const file of await findLicenseFiles(sourceDirectory)) {
    files.set(file.name, file.path);
  }

  for (const [name, sourcePath] of files) {
    await copyFile(sourcePath, join(targetDirectory, name));
  }
}

async function findLicenseFiles(sourceDirectory) {
  const files = new Map();
  const directories = [sourceDirectory, dirname(sourceDirectory)];

  for (const directory of directories) {
    for (const name of ['LICENSE', 'COPYING', 'README.txt']) {
      const path = join(directory, name);
      if ((await isFile(path)) && !files.has(name)) {
        files.set(name, { name, path });
      }
    }
  }

  return [...files.values()];
}

/** 真实执行 -version，确保复制后的二进制可启动且版本输出可解析。 */
async function verifyBundle(targetDirectory) {
  const ffmpegVersion = await runVersion(join(targetDirectory, ffmpegName));
  const ffprobeVersion = await runVersion(join(targetDirectory, ffprobeName));
  return { ffmpegVersion, ffprobeVersion };
}

function runVersion(executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-version'], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      reject(new Error(`无法启动 ${basename(executable)}：${error.message}`));
    });
    child.on('close', (code) => {
      const firstLine = stdout.split(/\r?\n/).find(Boolean) ?? '';
      if (code !== 0 || !/version/i.test(firstLine)) {
        reject(
          new Error(
            `${basename(executable)} -version 失败（exit=${code}）：${stderr || firstLine || '无输出'}`,
          ),
        );
        return;
      }
      resolve(firstLine.trim());
    });
  });
}

/** 记录真实版本和文件大小，供打包验收和问题排查使用。 */
async function writeManifest(sourceDirectory, targetDirectory, versions) {
  const entries = await readdir(targetDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const info = await stat(join(targetDirectory, entry.name));
    files.push({ name: entry.name, bytes: info.size });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    platform: targetPlatform,
    arch: targetArch,
    source: basename(sourceDirectory),
    versions,
    files: files.sort((left, right) => left.name.localeCompare(right.name)),
  };

  await writeFile(
    join(targetDirectory, 'bundle-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

void main().catch((error) => {
  console.error(`[ffmpeg] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
