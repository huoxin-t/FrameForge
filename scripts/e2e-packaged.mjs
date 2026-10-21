/**
 * 阶段 5 打包版真实 E2E。
 *
 * 验收目标：
 * - 在移除系统 PATH 和 FRAMEFORGE_FFMPEG_DIR 的进程环境中启动安装目录版；
 * - 应用必须使用 resources/ffmpeg/<platform>-<arch> 下的内置 FFmpeg/FFprobe；
 * - 用真实中文/空格路径视频完成导入、缩略图、转换、输出验证；
 * - 主界面不再出现开发者环境面板，但 FFmpeg 状态仍然真实可见。
 *
 * 运行前先执行：npm run dist:dir
 * 运行：node scripts/e2e-packaged.mjs
 */
import { spawn } from 'node:child_process';
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const exePath = process.env.FRAMEFORGE_E2E_EXE
  ? resolve(process.env.FRAMEFORGE_E2E_EXE)
  : join(root, 'release', 'win-unpacked', 'FrameForge.exe');
const ffmpegDirectory = join(
  root,
  'resources',
  'ffmpeg',
  `${process.platform}-${process.arch}`,
);
const ffmpegPath = join(
  ffmpegDirectory,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
);
const ffprobePath = join(
  ffmpegDirectory,
  process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
);
const inputPath = join(
  root,
  'test-results',
  'phase5-e2e',
  '输入 样本',
  '阶段五 真实 视频.mp4',
);
const outputDirectory = join(
  root,
  'test-results',
  'phase5-e2e',
  '输出 目录',
);
const userDataDirectory = join(root, 'test-results', 'phase5-e2e', 'user-data');
const screenshotPath = process.env.FRAMEFORGE_E2E_SCREENSHOT
  ? resolve(process.env.FRAMEFORGE_E2E_SCREENSHOT)
  : join(root, 'docs', 'evidence', 'phase5-packaged.png');
const port = 9335;

class Cdp {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });

    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener(
        'error',
        () => reject(new Error('CDP WebSocket 连接失败')),
        { once: true },
      );
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function main() {
  await assertExists(exePath, '打包应用');
  await assertExists(ffmpegPath, '内置 ffmpeg');
  await assertExists(ffprobePath, '内置 ffprobe');

  await prepareDirectories();
  await ensureInputVideo();

  const appEnvironment = createIsolatedEnvironment();
  const child = spawn(
    exePath,
    [
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${userDataDirectory}`,
    ],
    { env: appEnvironment, stdio: 'ignore' },
  );

  let cdp;

  try {
    const target = await waitForTarget(port);
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    await waitFor(
      () =>
        evaluate(
          cdp,
          `typeof window.desktopAPI === 'object' && document.body.innerText.includes('FFmpeg 已就绪')`,
        ),
      '应用与内置 FFmpeg 状态',
      30_000,
    );

    const ffmpegStatus = await evaluate(
      cdp,
      'window.desktopAPI.getFfmpegStatus()',
    );
    assertBundledStatus(ffmpegStatus);

    const bodyText = await evaluate(cdp, 'document.body.innerText');
    assertNoDeveloperPanel(bodyText);

    let importMode = 'drag-drop';
    try {
      await importThroughWorkspace(cdp, inputPath);
    } catch (error) {
      importMode = 'direct-api-fallback';
      console.warn(
        `拖拽导入未完成，回退到受控导入 API：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const imported = await evaluate(
      cdp,
      `window.desktopAPI.importVideos([${JSON.stringify(inputPath)}])`,
    );
    const item = assertImportedItem(imported);

    const created = await evaluate(
      cdp,
      `window.desktopAPI.startConversions(${JSON.stringify({
        sourcePaths: [inputPath],
        settings: {
          format: 'mp4',
          qualityPreset: 'compatible',
          outputDirectory,
        },
      })})`,
    );
    if (!Array.isArray(created) || created.length !== 1) {
      throw new Error(`启动转换结果异常：${JSON.stringify(created)}`);
    }

    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.querySelector('section[aria-label="任务队列"]')?.innerText.includes('已完成') === true`,
        ),
      '真实转换完成',
      60_000,
    );

    const outputPath = created[0].outputPath;
    const outputStat = await stat(outputPath);
    if (outputStat.size <= 0) {
      throw new Error('输出文件为空');
    }

    const probe = await runProcess(ffprobePath, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height',
      '-of',
      'json',
      outputPath,
    ]);
    const probeData = JSON.parse(probe);
    const stream = probeData.streams?.[0];
    if (
      stream?.codec_name !== 'h264' ||
      stream?.width !== 640 ||
      stream?.height !== 360
    ) {
      throw new Error(`输出视频探测异常：${probe}`);
    }

    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    await evaluate(cdp, 'window.close()');
    await waitForExit(child, 5_000);

    console.log(
      JSON.stringify(
        {
          appEnvironment: {
            PATH: appEnvironment.PATH ?? null,
            FRAMEFORGE_FFMPEG_DIR: appEnvironment.FRAMEFORGE_FFMPEG_DIR ?? null,
          },
          ffmpegStatus,
          importMode,
          imported: {
            fileName: item.fileName,
            width: item.metadata.width,
            height: item.metadata.height,
            durationMs: item.metadata.durationMs,
            thumbnailBytes: item.thumbnailDataUrl.length,
          },
          outputPath,
          outputBytes: outputStat.size,
          outputStream: stream,
          screenshotPath,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    cdp?.close();
  }
}

async function prepareDirectories() {
  await mkdir(dirname(inputPath), { recursive: true });
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await rm(userDataDirectory, { recursive: true, force: true });
  await mkdir(userDataDirectory, { recursive: true });
  await mkdir(dirname(screenshotPath), { recursive: true });
}

async function ensureInputVideo() {
  if (await exists(inputPath)) {
    return;
  }

  await runProcess(ffmpegPath, [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=30:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    inputPath,
  ]);

  await assertExists(inputPath, 'E2E 输入视频');
}

/** 只保留 Windows/Electron 启动必需变量，移除 PATH 和显式 FFmpeg 覆盖。 */
function createIsolatedEnvironment() {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^path$/i.test(key) || /^FRAMEFORGE_FFMPEG/i.test(key)) {
      continue;
    }
    environment[key] = value;
  }
  return environment;
}

/** 通过真实 CDP 拖拽事件把文件交给工作区，让 renderer 自己完成导入。 */
async function importThroughWorkspace(cdp, filePath) {
  const point = await evaluate(
    cdp,
    `(() => {
      const zone = document.querySelector('[data-testid="workspace-dropzone"]');
      if (!zone) throw new Error('找不到工作区拖拽区域');
      const rect = zone.getBoundingClientRect();
      return {
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      };
    })()`,
  );
  const dragData = {
    items: [],
    files: [filePath],
    dragOperationsMask: 1,
  };

  await cdp.send('Input.setInterceptDrags', { enabled: true });
  await cdp.send('Input.dispatchDragEvent', {
    type: 'dragEnter',
    ...point,
    data: dragData,
  });
  await waitFor(
    () =>
      evaluate(
        cdp,
        `document.body.innerText.includes('松开以导入视频')`,
      ),
    '拖拽覆盖层',
    5_000,
  );
  await cdp.send('Input.dispatchDragEvent', {
    type: 'dragOver',
    ...point,
    data: dragData,
  });
  await cdp.send('Input.dispatchDragEvent', {
    type: 'drop',
    ...point,
    data: dragData,
  });
  await waitFor(
    () =>
      evaluate(
        cdp,
        `document.body.innerText.includes(${JSON.stringify(basename(filePath))})`,
      ),
    '拖拽导入媒体卡片',
    15_000,
  );
}

function assertBundledStatus(status) {
  if (!status?.available) {
    throw new Error(`FFmpeg 未就绪：${JSON.stringify(status)}`);
  }
  if (status.source !== 'bundled') {
    throw new Error(`未使用内置 FFmpeg：${JSON.stringify(status)}`);
  }
  if (!String(status.ffmpegPath).includes('resources\\ffmpeg\\')) {
    throw new Error(`FFmpeg 路径不在随包目录：${status.ffmpegPath}`);
  }
}

function assertNoDeveloperPanel(bodyText) {
  for (const forbidden of ['运行环境', 'FFmpeg 路径', 'Node.js', 'Electron 45']) {
    if (bodyText.includes(forbidden)) {
      throw new Error(`主界面仍展示开发者信息：${forbidden}`);
    }
  }
}

function assertImportedItem(imported) {
  if (!Array.isArray(imported) || imported.length !== 1) {
    throw new Error(`导入结果异常：${JSON.stringify(imported)}`);
  }

  const item = imported[0];
  if (
    item.metadata?.width !== 640 ||
    item.metadata?.height !== 360 ||
    !item.thumbnailDataUrl?.startsWith('data:image/jpeg;base64,')
  ) {
    throw new Error(`导入元数据/缩略图异常：${JSON.stringify(item)}`);
  }

  return item;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertExists(path, label) {
  if (!(await exists(path))) {
    throw new Error(`${label}不存在：${path}`);
  }
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
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
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(`${executable} 退出码 ${code}：${stderr || stdout || '无输出'}`),
      );
    });
  });
}

function waitForTarget(debugPort) {
  const deadline = Date.now() + 30_000;
  let lastError;

  return (async () => {
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        if (response.ok) {
          const targets = await response.json();
          const page = targets.find(
            (candidate) =>
              candidate.type === 'page' &&
              typeof candidate.webSocketDebuggerUrl === 'string',
          );
          if (page) {
            return page;
          }
        }
      } catch (error) {
        lastError = error;
      }
      await delay(250);
    }

    throw new Error(`未找到 Electron 调试页面：${lastError ?? 'timeout'}`);
  })();
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        'Runtime.evaluate 失败',
    );
  }
  return response.result.value;
}

async function waitFor(predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`等待超时：${label}${lastError ? `（${lastError.message}）` : ''}`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, timeoutMs);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

void main().catch((error) => {
  console.error(`[e2e] ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
