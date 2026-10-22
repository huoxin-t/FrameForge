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
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
const advancedInputPath = join(
  root,
  'test-results',
  'phase5-e2e',
  '输入 样本',
  '阶段七 高级 视频.mp4',
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
  : join(root, 'docs', 'evidence', 'phase6-formats.png');
const mp3ScreenshotPath = join(root, 'docs', 'evidence', 'phase6-mp3.png');
const advancedScreenshotPath = join(
  root,
  'docs',
  'evidence',
  'phase7-advanced.png',
);
const historyScreenshotPath = join(
  root,
  'docs',
  'evidence',
  'phase8-history.png',
);
const historyFilePath = join(userDataDirectory, 'conversion-history.json');
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
  await ensureAdvancedInputVideo();

  const appEnvironment = createIsolatedEnvironment();
  let firstApp = null;
  let secondApp = null;
  let cdp = null;
  let secondCdp = null;

  try {
    firstApp = await launchPackagedApp(appEnvironment);
    cdp = firstApp.cdp;
    await waitForAppReady(cdp);

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

    let defaultOutputDirectory = null;
    if (importMode === 'drag-drop') {
      await waitFor(
        () =>
          evaluate(
            cdp,
            `document.querySelector('[data-testid="output-directory"]')?.textContent?.trim() === ${JSON.stringify(
              dirname(inputPath),
            )}`,
          ),
        '首个源文件目录自动成为输出目录',
        10_000,
      );
      defaultOutputDirectory = await evaluate(
        cdp,
        `document.querySelector('[data-testid="output-directory"]')?.textContent?.trim() ?? null`,
      );
    }

    const initialHistory = await evaluate(
      cdp,
      'window.desktopAPI.getConversionHistory()',
    );
    if (!Array.isArray(initialHistory) || initialHistory.length !== 0) {
      throw new Error(`全新 userData 不应已有历史：${JSON.stringify(initialHistory)}`);
    }

    const capabilities = await evaluate(
      cdp,
      'window.desktopAPI.getConversionCapabilities()',
    );
    assertCapabilities(capabilities);
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.body.innerText.includes('WebM') && document.body.innerText.includes('MP3')`,
        ),
      'WebM/MP3 格式选项',
      10_000,
    );

    const conversionSpecs = [
      {
        format: 'mp4',
        qualityPreset: 'compatible',
        expectedVideo: 'h264',
        expectedAudio: 'aac',
      },
      {
        format: 'webm',
        qualityPreset: 'compatible',
        expectedVideo: 'vp9',
        expectedAudio: 'opus',
      },
      {
        format: 'mp3',
        qualityPreset: 'quality',
        expectedVideo: null,
        expectedAudio: 'mp3',
      },
    ];
    const conversions = {};
    for (const [index, spec] of conversionSpecs.entries()) {
      conversions[spec.format] = await runFormatConversion({
        cdp,
        sourcePath: inputPath,
        targetDirectory: outputDirectory,
        spec,
        expectedCompleted: index + 1,
      });
    }

    console.log('START 打包版高级设置真实转换');
    conversions.advanced = await runFormatConversion({
      cdp,
      sourcePath: advancedInputPath,
      targetDirectory: outputDirectory,
      spec: {
        format: 'mp4',
        qualityPreset: 'quality',
        advanced: {
          resolution: '480p',
          crf: 18,
          audioBitrateKbps: 128,
          audioMode: 'remove',
        },
        expectedVideo: 'h264',
        expectedAudio: null,
        expectedWidth: 854,
        expectedHeight: 480,
      },
      expectedCompleted: 4,
    });

    const historyEntries = await waitForHistoryCount(cdp, 4);
    assertHistoryEntries(historyEntries, ['mp3', 'mp4', 'mp4', 'webm']);
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.querySelector('section[aria-label="转换历史"]')?.innerText.includes('已完成') === true`,
        ),
      '右侧栏历史卡片显示已完成记录',
      10_000,
    );

    await selectFormat(cdp, 'webm');
    await waitFor(
      () => evaluate(cdp, `document.body.innerText.includes('VP9 + Opus')`),
      'WebM 格式摘要',
      10_000,
    );
    await captureFullPage(cdp, screenshotPath);

    await selectFormat(cdp, 'mp3');
    await waitFor(
      () => evaluate(cdp, `document.body.innerText.includes('仅导出音频')`),
      'MP3 音频-only 说明',
      10_000,
    );
    await captureFullPage(cdp, mp3ScreenshotPath);

    await selectFormat(cdp, 'mp4');
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.body.innerText.includes('H.264 CRF')`,
        ),
      'MP4 格式摘要',
      10_000,
    );
    await openAdvancedPanel(cdp);
    await setAdvancedResolution(cdp, '480p');
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.body.innerText.includes('FFmpeg 命令预览') && document.body.innerText.includes('-progress pipe:1')`,
        ),
      '高级设置命令预览',
      10_000,
    );
    await toggleCommandPreview(cdp, false);
    await toggleCommandPreview(cdp, true);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1344,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(300);
    await scrollWorkspaceToTop(cdp);
    await captureFullPage(cdp, advancedScreenshotPath);
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    await closePackagedApp(firstApp);
    firstApp = null;
    cdp = null;

    const persistedHistory = await readHistoryFile();
    assertHistoryEntries(
      persistedHistory.entries,
      ['mp3', 'mp4', 'mp4', 'webm'],
      { requireOutputExists: false },
    );

    secondApp = await launchPackagedApp(appEnvironment);
    secondCdp = secondApp.cdp;
    await waitForAppReady(secondCdp);
    const reloadedHistory = await waitForHistoryCount(secondCdp, 4);
    assertHistoryEntries(reloadedHistory, ['mp3', 'mp4', 'mp4', 'webm']);
    await waitFor(
      () =>
        evaluate(
          secondCdp,
          `document.querySelector('section[aria-label="转换历史"]')?.innerText.includes('已完成') === true`,
        ),
      '重启后右侧栏历史卡片恢复记录',
      10_000,
    );

    await secondCdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1344,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(300);
    await scrollWorkspaceToTop(secondCdp);
    await captureFullPage(secondCdp, historyScreenshotPath);
    await secondCdp.send('Emulation.clearDeviceMetricsOverride');

    await clearHistoryThroughUi(secondCdp);
    await waitFor(
      () =>
        evaluate(
          secondCdp,
          `document.querySelector('section[aria-label="转换历史"]')?.innerText.includes('完成一次转换后，记录会出现在这里。') === true`,
        ),
      '清空历史后的空状态',
      10_000,
    );
    const clearedHistory = await evaluate(
      secondCdp,
      'window.desktopAPI.getConversionHistory()',
    );
    if (!Array.isArray(clearedHistory) || clearedHistory.length !== 0) {
      throw new Error(`清空历史失败：${JSON.stringify(clearedHistory)}`);
    }
    const clearedHistoryFile = await readHistoryFile();
    if (
      !Array.isArray(clearedHistoryFile.entries) ||
      clearedHistoryFile.entries.length !== 0
    ) {
      throw new Error(
        `历史文件清空失败：${JSON.stringify(clearedHistoryFile)}`,
      );
    }

    const outputs = Object.values(conversions).map(
      (conversion) => conversion.outputPath,
    );
    for (const outputPath of outputs) {
      await assertExists(outputPath, '清空历史后保留的输出文件');
    }

    await closePackagedApp(secondApp);
    secondApp = null;
    secondCdp = null;

    console.log(
      JSON.stringify(
        {
          appEnvironment: {
            PATH: appEnvironment.PATH ?? null,
            FRAMEFORGE_FFMPEG_DIR: appEnvironment.FRAMEFORGE_FFMPEG_DIR ?? null,
          },
          ffmpegStatus,
          capabilities: {
            error: capabilities.error,
            encoders: capabilities.encoders,
            formats: capabilities.formats,
          },
          importMode,
          imported: {
            fileName: item.fileName,
            width: item.metadata.width,
            height: item.metadata.height,
            durationMs: item.metadata.durationMs,
            thumbnailBytes: item.thumbnailDataUrl.length,
          },
          defaultOutputDirectory,
          conversions,
          history: {
            initialCount: initialHistory.length,
            count: historyEntries.length,
            persistedPath: historyFilePath,
            persistedCount: persistedHistory.entries.length,
            reloadedCount: reloadedHistory.length,
            clearedCount: clearedHistory.length,
            outputsRetained: outputs.length,
            screenshotPath: historyScreenshotPath,
          },
          screenshotPath,
          mp3ScreenshotPath,
          advancedScreenshotPath,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    firstApp?.child.kill();
    secondApp?.child.kill();
    throw error;
  } finally {
    firstApp?.cdp.close();
    secondApp?.cdp.close();
  }
}

async function launchPackagedApp(environment) {
  const child = spawn(
    exePath,
    [
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${userDataDirectory}`,
    ],
    { env: environment, stdio: 'ignore' },
  );

  try {
    const target = await waitForTarget(port);
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    return { child, cdp };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function waitForAppReady(cdp) {
  await waitFor(
    () =>
      evaluate(
        cdp,
        `typeof window.desktopAPI === 'object' && document.body.innerText.includes('FFmpeg 已就绪')`,
      ),
    '应用与内置 FFmpeg 状态',
    30_000,
  );
}

async function closePackagedApp(app) {
  try {
    await evaluate(app.cdp, 'window.close()');
  } finally {
    await waitForExit(app.child, 5_000);
    app.cdp.close();
  }
}

async function toggleCommandPreview(cdp, expanded) {
  await evaluate(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes('FFmpeg 命令预览'),
      );
      if (!button) {
        throw new Error('未找到 FFmpeg 命令预览开关');
      }
      if (button.getAttribute('aria-expanded') !== '${expanded}') {
        button.click();
      }
      return true;
    })()`,
  );
  await waitFor(
    () =>
      evaluate(
        cdp,
        `Boolean(document.querySelector('[data-testid="command-preview"]')) === ${expanded}`,
      ),
    expanded ? '展开 FFmpeg 命令预览' : '折叠 FFmpeg 命令预览',
    10_000,
  );
}

async function clearHistoryThroughUi(cdp) {
  await evaluate(
    cdp,
    `(() => {
      const section = document.querySelector('section[aria-label="转换历史"]');
      if (!section) {
        throw new Error('未找到转换历史卡片');
      }
      const button = [...section.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === '清空',
      );
      if (!button) {
        throw new Error('未找到清空历史按钮');
      }
      button.click();
      return true;
    })()`,
  );
  await waitFor(
    () =>
      evaluate(
        cdp,
        `document.querySelector('section[aria-label="转换历史"]')?.innerText.includes('确认清空历史？') === true`,
      ),
    '清空历史二次确认',
    10_000,
  );
  await evaluate(
    cdp,
    `(() => {
      const section = document.querySelector('section[aria-label="转换历史"]');
      const button = [...section.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === '确认清空',
      );
      if (!button) {
        throw new Error('未找到确认清空按钮');
      }
      button.click();
      return true;
    })()`,
  );
}

async function waitForHistoryCount(cdp, expectedCount) {
  let entries = null;
  await waitFor(
    async () => {
      entries = await evaluate(cdp, 'window.desktopAPI.getConversionHistory()');
      return Array.isArray(entries) && entries.length === expectedCount;
    },
    `历史记录数量 ${expectedCount}`,
    10_000,
  );
  return entries;
}

function assertHistoryEntries(entries, expectedFormats, options = {}) {
  if (!Array.isArray(entries)) {
    throw new Error(`历史记录不是数组：${JSON.stringify(entries)}`);
  }
  if (entries.length !== expectedFormats.length) {
    throw new Error(`历史记录数量错误：${JSON.stringify(entries)}`);
  }
  const statuses = entries.map((entry) => entry.status);
  if (statuses.some((status) => status !== 'completed')) {
    throw new Error(`历史记录包含非完成终态：${JSON.stringify(entries)}`);
  }
  const formats = entries.map((entry) => entry.format).sort();
  const expected = [...expectedFormats].sort();
  if (JSON.stringify(formats) !== JSON.stringify(expected)) {
    throw new Error(
      `历史格式错误：${JSON.stringify(formats)}，期望 ${JSON.stringify(expected)}`,
    );
  }
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new Error(`历史记录 id 重复：${JSON.stringify(entries)}`);
  }
  if (options.requireOutputExists !== false) {
    const missing = entries.filter((entry) => entry.outputExists !== true);
    if (missing.length > 0) {
      throw new Error(`历史记录输出不存在：${JSON.stringify(missing)}`);
    }
  }
}

async function readHistoryFile() {
  const raw = await readFile(historyFilePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    throw new Error(`历史文件结构错误：${raw}`);
  }
  return parsed;
}

async function prepareDirectories() {
  await mkdir(dirname(inputPath), { recursive: true });
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await rm(userDataDirectory, { recursive: true, force: true });
  await mkdir(userDataDirectory, { recursive: true });
  await mkdir(dirname(screenshotPath), { recursive: true });
  await mkdir(dirname(mp3ScreenshotPath), { recursive: true });
  await mkdir(dirname(advancedScreenshotPath), { recursive: true });
  await mkdir(dirname(historyScreenshotPath), { recursive: true });
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

async function ensureAdvancedInputVideo() {
  if (await exists(advancedInputPath)) {
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
    'testsrc=size=1280x720:rate=30:duration=3',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=660:duration=3',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    advancedInputPath,
  ]);

  await assertExists(advancedInputPath, 'E2E 高级设置输入视频');
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

async function selectFormat(cdp, format) {
  const selected = await evaluate(
    cdp,
    `(() => {
      const select = document.querySelector('#conversion-format');
      if (!select) throw new Error('找不到输出格式选择器');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set;
      setter.call(select, ${JSON.stringify(format)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()`,
  );
  if (selected !== format) {
    throw new Error(`格式选择失败：期望 ${format}，实际 ${selected}`);
  }
}

async function openAdvancedPanel(cdp) {
  await evaluate(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes('高级设置'),
      );
      if (!button) throw new Error('找不到高级设置按钮');
      if (button.getAttribute('aria-expanded') !== 'true') {
        button.click();
      }
      return true;
    })()`,
  );
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector('#advanced-resolution'))`),
    '高级设置面板',
    5_000,
  );
}

async function setAdvancedResolution(cdp, resolution) {
  const selected = await evaluate(
    cdp,
    `(() => {
      const select = document.querySelector('#advanced-resolution');
      if (!select) throw new Error('找不到高级分辨率选择器');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set;
      setter.call(select, ${JSON.stringify(resolution)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()`,
  );
  if (selected !== resolution) {
    throw new Error(`高级分辨率选择失败：期望 ${resolution}，实际 ${selected}`);
  }
}

async function scrollWorkspaceToTop(cdp) {
  await evaluate(
    cdp,
    `(() => {
      const containers = [...document.querySelectorAll('.overflow-auto')];
      for (const container of containers) {
        container.scrollTop = 0;
      }
      return true;
    })()`,
  );
}

async function captureFullPage(cdp, targetPath) {
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const size = metrics.cssContentSize ?? metrics.contentSize;
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: Math.ceil(size.width),
      height: Math.ceil(size.height),
      scale: 1,
    },
  });
  await writeFile(targetPath, Buffer.from(screenshot.data, 'base64'));
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

function assertCapabilities(capabilities) {
  if (!capabilities || capabilities.error) {
    throw new Error(`编码器能力检测失败：${JSON.stringify(capabilities)}`);
  }

  for (const encoder of [
    'libx264',
    'aac',
    'libvpx-vp9',
    'libopus',
    'libmp3lame',
  ]) {
    if (capabilities.encoders?.[encoder] !== true) {
      throw new Error(`编码器能力缺失：${encoder}`);
    }
  }

  for (const format of ['mp4', 'webm', 'mp3']) {
    const capability = capabilities.formats?.find(
      (candidate) => candidate.format === format,
    );
    if (!capability?.available) {
      throw new Error(`格式能力不可用：${JSON.stringify(capability)}`);
    }
  }
}

async function runFormatConversion({
  cdp,
  sourcePath,
  targetDirectory,
  spec,
  expectedCompleted,
}) {
  const created = await evaluate(
    cdp,
    `window.desktopAPI.startConversions(${JSON.stringify({
      sourcePaths: [sourcePath],
      settings: {
        format: spec.format,
        qualityPreset: spec.qualityPreset,
        outputDirectory: targetDirectory,
        ...(spec.advanced ? { advanced: spec.advanced } : {}),
      },
    })})`,
  );
  if (!Array.isArray(created) || created.length !== 1) {
    throw new Error(`启动 ${spec.format} 转换结果异常：${JSON.stringify(created)}`);
  }

  const outputPath = created[0].outputPath;
  if (!outputPath.endsWith(`.${spec.format}`)) {
    throw new Error(`输出扩展名错误：${outputPath}`);
  }

  await waitFor(
    () =>
      evaluate(
        cdp,
        `document.querySelector('section[aria-label="任务队列"]')?.innerText.includes(${JSON.stringify(
          `完成 ${expectedCompleted} / ${expectedCompleted}`,
        )}) === true`,
      ),
    `${spec.format} 任务完成`,
    90_000,
  );

  const outputStat = await stat(outputPath);
  if (outputStat.size <= 0) {
    throw new Error(`${spec.format} 输出文件为空`);
  }

  const probeText = await runProcess(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,width,height',
    '-of',
    'json',
    outputPath,
  ]);
  const probeData = JSON.parse(probeText);
  const streams = Array.isArray(probeData.streams) ? probeData.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video') ?? null;
  const audio = streams.find((stream) => stream.codec_type === 'audio') ?? null;

  if (spec.expectedVideo === null) {
    if (video) {
      throw new Error(`${spec.format} 不应包含视频轨道：${probeText}`);
    }
  } else if (
    video?.codec_name !== spec.expectedVideo ||
    video?.width !== (spec.expectedWidth ?? 640) ||
    video?.height !== (spec.expectedHeight ?? 360)
  ) {
    throw new Error(`${spec.format} 视频探测异常：${probeText}`);
  }

  if (spec.expectedAudio === null) {
    if (audio) {
      throw new Error(`${spec.format} 不应包含音频轨道：${probeText}`);
    }
  } else if (audio?.codec_name !== spec.expectedAudio) {
    throw new Error(`${spec.format} 音频探测异常：${probeText}`);
  }

  return {
    outputPath,
    outputBytes: outputStat.size,
    video,
    audio,
  };
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
