/**
 * 阶段 1 测试：Electron 桌面骨架、安全边界与日志编排。
 *
 * 组织方式：
 * - 一个阶段只保留一个测试文件，避免测试文件数量膨胀。
 * - 文件内按流程分组：IPC 契约、窗口配置、导航安全、日志器、运行时信息、
 *   启动编排、renderer 边界、工作台、IPC 调用方校验。
 * - 每个用例仍由全局钩子输出 START / PASS / FAIL，关键步骤输出 STEP。
 *
 * 对应需求：
 * - renderer 不直接访问 Node / Electron。
 * - preload 只暴露最小 API。
 * - contextIsolation / sandbox / nodeIntegration 安全配置。
 * - 主函数编排子函数，子函数使用真实日志。
 * - 真实 Electron 窗口可启动，IPC 可调用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import log from 'electron-log/node';
import type { BrowserWindow } from 'electron';
import { render, screen } from '@testing-library/react';

import { DESKTOP_API_KEYS, IPC_CHANNELS, type AppInfo, type DesktopAPI } from '../shared/ipc';
import { createDesktopApi } from '../electron/preload/api';
import { createWindowOptions } from '../electron/main/window-options';
import { hardenWindow, isAllowedNavigation } from '../electron/main/security';
import { createScopedLogger } from '../electron/main/services/logger-core';
import { buildAppInfo } from '../electron/main/services/app-info';
import { runMain, type MainDependencies } from '../electron/main/orchestrator';
import { isTrustedSender } from '../electron/main/ipc/guard';
import App from '../src/App';
import { createTestLogger } from './helpers/test-logger';

// ============================================================================
// IPC 契约
// ============================================================================

const ipcLogger = createTestLogger('phase-01/ipc-contract');

describe('阶段 1 / IPC 契约', () => {
  it('暴露受控 API 且至少包含 getAppInfo', () => {
    ipcLogger.info('STEP 读取 preload 暴露的 API 键');
    const keys = [...DESKTOP_API_KEYS].sort();

    ipcLogger.info('STEP 断言 getAppInfo 存在，具体阶段 2 API 由阶段 2 测试约束', { keys });
    expect(keys).toContain('getAppInfo');
  });

  it('不暴露危险能力', () => {
    const forbidden = [
      'runCommand',
      'exec',
      'spawn',
      'invoke',
      'ipcRenderer',
      'readFile',
      'writeFile',
      'fs',
    ];

    ipcLogger.info('STEP 检查危险能力是否被误暴露', { forbidden });
    for (const key of forbidden) {
      expect(DESKTOP_API_KEYS).not.toContain(key);
    }
  });

  it('getAppInfo 必须走类型化通道', async () => {
    const invoke = vi.fn().mockResolvedValue({ version: '0.1.0' });
    const api: DesktopAPI = createDesktopApi(invoke);

    ipcLogger.info('STEP 调用 DesktopAPI.getAppInfo');
    await api.getAppInfo();

    ipcLogger.info('STEP 断言调用通道', { expectedChannel: IPC_CHANNELS.getAppInfo });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.getAppInfo);
  });

  it('IPC 通道名保持命名空间格式', () => {
    ipcLogger.info('STEP 校验所有 IPC 通道命名');
    for (const channel of Object.values(IPC_CHANNELS)) {
      expect(channel).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });
});

// ============================================================================
// 窗口安全配置
// ============================================================================

const windowLogger = createTestLogger('phase-01/window-options');

describe('阶段 1 / 窗口安全配置', () => {
  it('启用 Electron 安全默认值', () => {
    windowLogger.info('STEP 生成开发模式窗口配置');
    const options = createWindowOptions({
      preloadPath: 'C:\\app\\preload\\index.js',
      isPackaged: false,
    });

    windowLogger.info('STEP 断言安全开关', { webPreferences: options.webPreferences });
    expect(options.webPreferences).toMatchObject({
      preload: 'C:\\app\\preload\\index.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });

  it('打包版关闭 DevTools', () => {
    windowLogger.info('STEP 对比打包版与开发版 DevTools 配置');
    expect(
      createWindowOptions({ preloadPath: 'p', isPackaged: true }).webPreferences?.devTools,
    ).toBe(false);
    expect(
      createWindowOptions({ preloadPath: 'p', isPackaged: false }).webPreferences?.devTools,
    ).toBe(true);
  });

  it('使用桌面尺寸且允许缩放', () => {
    windowLogger.info('STEP 校验默认窗口尺寸与缩放能力');
    const options = createWindowOptions({ preloadPath: 'p', isPackaged: false });

    expect(options.width).toBe(1360);
    expect(options.height).toBe(860);
    expect(options.minWidth).toBeGreaterThanOrEqual(1024);
    expect(options.resizable).not.toBe(false);
  });
});

// ============================================================================
// 导航安全
// ============================================================================

const securityLogger = createTestLogger('phase-01/security');

describe('阶段 1 / 导航安全', () => {
  it('只允许停留在当前页面', () => {
    securityLogger.info('STEP 校验同源同路径、跨源、跨路径、file URL 与非法 URL');

    // 同源同路径：允许。
    expect(isAllowedNavigation('http://localhost:5173/', 'http://localhost:5173/')).toBe(true);
    // 跨源：拒绝。
    expect(isAllowedNavigation('http://localhost:5173/', 'https://evil.example/')).toBe(false);
    // 同源但不同路径：拒绝，避免导航到应用内未知页面。
    expect(isAllowedNavigation('http://localhost:5173/', 'http://localhost:5173/other')).toBe(
      false,
    );
    // 打包后的 file URL：同一文件允许。
    expect(isAllowedNavigation('file:///C:/app/index.html', 'file:///C:/app/index.html')).toBe(
      true,
    );
    // file 协议下也不能允许跳到系统其他文件。
    expect(
      isAllowedNavigation('file:///C:/app/index.html', 'file:///C:/Windows/system32/calc.exe'),
    ).toBe(false);
    // 非法 URL 不能被当作合法目标。
    expect(isAllowedNavigation('not a url', 'http://localhost:5173/')).toBe(false);
  });

  it('拒绝 window.open', () => {
    const setWindowOpenHandler = vi.fn().mockReturnValue({ action: 'deny' });
    const on = vi.fn();
    const fakeWindow = {
      webContents: { setWindowOpenHandler, on },
    } as unknown as BrowserWindow;

    securityLogger.info('STEP 安装窗口安全处理器');
    hardenWindow(fakeWindow, 'http://localhost:5173/');

    securityLogger.info('STEP 断言 setWindowOpenHandler 已注册');
    expect(setWindowOpenHandler).toHaveBeenCalledTimes(1);
  });

  it('阻止导航到不可信 URL', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const fakeWindow = {
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: (event: string, handler: (...args: unknown[]) => void) => {
          handlers.set(event, handler);
        },
      },
    } as unknown as BrowserWindow;

    hardenWindow(fakeWindow, 'http://localhost:5173/');

    securityLogger.info('STEP 触发 will-navigate，目标为外部 URL');
    const preventDefault = vi.fn();
    handlers.get('will-navigate')?.({ preventDefault }, 'https://evil.example/');

    securityLogger.info('STEP 断言导航被阻止');
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 日志器
// ============================================================================

const loggerTest = createTestLogger('phase-01/logger');
let logDirectory: string | undefined;

afterEach(() => {
  // 先关闭文件传输，再删除目录，避免 electron-log 继续指向已删除的路径。
  log.transports.file.level = false;
  log.transports.console.level = 'info';

  if (logDirectory) {
    rmSync(logDirectory, { recursive: true, force: true });
    logDirectory = undefined;
  }
});

/** 为单个用例创建独立的临时日志文件。 */
function createFileLogger() {
  logDirectory = mkdtempSync(join(tmpdir(), 'frameforge-log-'));
  const file = join(logDirectory, 'main.log');

  log.transports.file.resolvePathFn = () => file;
  log.transports.file.level = 'info';

  return {
    file,
    logger: createScopedLogger(log, 'test-scope'),
  };
}

/** 轮询等待 electron-log 真正写入目标文本。 */
async function waitForContent(file: string, needle: string): Promise<string> {
  const deadline = Date.now() + 2000;
  let content = '';

  while (Date.now() < deadline) {
    if (existsSync(file)) {
      content = readFileSync(file, 'utf8');
      if (content.includes(needle)) {
        return content;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }

  return content;
}

describe('阶段 1 / 日志器', () => {
  it('把带 scope 的 info 日志写入真实文件', async () => {
    loggerTest.info('STEP 创建临时日志目录');
    const { file, logger } = createFileLogger();

    loggerTest.info('STEP 写入 info 日志', { file });
    logger.info('hello from test', { jobId: 'job-1' });

    const content = await waitForContent(file, 'hello from test');
    loggerTest.info('STEP 读取并断言日志内容', { bytes: content.length });

    expect(content).toContain('[test-scope]');
    expect(content).toContain('hello from test');
    expect(content).toContain('job-1');
  });

  it('文件级别为 info 时过滤 debug', async () => {
    loggerTest.info('STEP 创建临时日志目录');
    const { file, logger } = createFileLogger();

    loggerTest.info('STEP 同时写入 debug 和 info');
    logger.debug('this should not be written');
    logger.info('this should be written');

    const content = await waitForContent(file, 'this should be written');
    loggerTest.info('STEP 断言 debug 被过滤');

    expect(content).toContain('this should be written');
    expect(content).not.toContain('this should not be written');
  });

  it('Error 对象保留消息和堆栈', async () => {
    loggerTest.info('STEP 创建临时日志目录');
    const { file, logger } = createFileLogger();

    // 下面 stderr 中的 [error] 是本用例故意写入的日志对象，不是测试失败。
    loggerTest.info('STEP 故意写入带 Error 对象的 error 日志（预期 stderr 出现 error）');
    logger.error('conversion failed', { error: new Error('ffmpeg exploded') });

    const content = await waitForContent(file, 'ffmpeg exploded');
    loggerTest.info('STEP 断言错误消息和堆栈存在');

    expect(content).toContain('conversion failed');
    expect(content).toContain('ffmpeg exploded');
    expect(content).toContain('Error');
  });
});

// ============================================================================
// 运行时信息
// ============================================================================

const infoLogger = createTestLogger('phase-01/app-info');

describe('阶段 1 / 运行时信息', () => {
  it('把真实运行时版本映射为公开契约', () => {
    infoLogger.info('STEP 构造完整的运行时版本数据');
    const info = buildAppInfo({
      version: '1.2.3',
      versions: {
        electron: '45.0.0',
        chrome: '140.0.0',
        node: '24.0.0',
      },
      platform: 'win32',
      arch: 'x64',
    });

    infoLogger.info('STEP 断言公开字段映射', { info });
    expect(info).toEqual({
      name: 'FrameForge',
      version: '1.2.3',
      electronVersion: '45.0.0',
      chromeVersion: '140.0.0',
      nodeVersion: '24.0.0',
      platform: 'win32',
      arch: 'x64',
    });
  });

  it('Electron / Chromium 版本缺失时显示未知', () => {
    infoLogger.info('STEP 构造缺少 Electron / Chromium 版本的数据');
    const info = buildAppInfo({
      version: '1.2.3',
      versions: { node: '24.0.0' },
      platform: 'win32',
      arch: 'x64',
    });

    infoLogger.info('STEP 断言降级文案不是 undefined');
    expect(info.electronVersion).toBe('未知');
    expect(info.chromeVersion).toBe('未知');
  });
});

// ============================================================================
// 启动编排
// ============================================================================

const orchestratorLogger = createTestLogger('phase-01/orchestrator');

/** 构造四个可观察的启动阶段，把调用顺序记录到数组。 */
function createDependencies(calls: string[]): MainDependencies {
  return {
    initLogger: async () => {
      calls.push('initLogger');
    },
    registerIpcHandlers: () => {
      calls.push('registerIpcHandlers');
    },
    createMainWindow: async () => {
      calls.push('createMainWindow');
    },
    registerAppLifecycle: () => {
      calls.push('registerAppLifecycle');
    },
  };
}

describe('阶段 1 / 启动编排', () => {
  it('按固定顺序执行启动阶段', async () => {
    const calls: string[] = [];
    orchestratorLogger.info('STEP 注入可观察的启动依赖');

    await runMain(createDependencies(calls));

    orchestratorLogger.info('STEP 断言启动顺序', { calls });
    expect(calls).toEqual([
      'initLogger',
      'registerIpcHandlers',
      'createMainWindow',
      'registerAppLifecycle',
    ]);
  });

  it('任一阶段失败时停止后续阶段', async () => {
    const calls: string[] = [];
    const dependencies = createDependencies(calls);
    dependencies.initLogger = vi.fn().mockRejectedValue(new Error('logger unavailable'));
    dependencies.registerIpcHandlers = vi.fn();
    dependencies.createMainWindow = vi.fn();
    dependencies.registerAppLifecycle = vi.fn();

    orchestratorLogger.info('STEP 让 initLogger 失败，观察后续阶段是否被调用');
    await expect(runMain(dependencies)).rejects.toThrow('logger unavailable');

    orchestratorLogger.info('STEP 断言后续阶段全部未执行');
    expect(dependencies.registerIpcHandlers).not.toHaveBeenCalled();
    expect(dependencies.createMainWindow).not.toHaveBeenCalled();
    expect(dependencies.registerAppLifecycle).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Renderer 进程边界
// ============================================================================

const boundaryLogger = createTestLogger('phase-01/renderer-boundary');
const rendererRoot = resolve(process.cwd(), 'src');
const forbiddenImport =
  /(?:from\s+['"](?:node:)?(?:fs|child_process|electron)['"]|require\s*\(\s*['"](?:node:)?(?:fs|child_process|electron)['"])/;

/** 递归收集 renderer 的 .ts / .tsx 源文件。 */
function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry);
    if (statSync(absolutePath).isDirectory()) {
      files.push(...collectSourceFiles(absolutePath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(absolutePath);
    }
  }

  return files;
}

describe('阶段 1 / Renderer 进程边界', () => {
  it('renderer 不导入 Node.js 或 Electron 模块', () => {
    boundaryLogger.info('STEP 扫描 renderer 源文件');
    const sources = collectSourceFiles(rendererRoot).map((file) => ({
      file: relative(process.cwd(), file),
      source: readFileSync(file, 'utf8'),
    }));

    boundaryLogger.info('STEP 检查禁止导入', { files: sources.length });
    const violations = sources.filter(({ source }) => forbiddenImport.test(source));

    expect(violations).toEqual([]);
  });

  it('renderer 不使用 CommonJS require', () => {
    boundaryLogger.info('STEP 扫描 renderer 中的 require 调用');
    const sources = collectSourceFiles(rendererRoot).map((file) => ({
      file: relative(process.cwd(), file),
      source: readFileSync(file, 'utf8'),
    }));

    boundaryLogger.info('STEP 断言没有 CommonJS require', { files: sources.length });
    const violations = sources.filter(({ source }) => /\brequire\s*\(/.test(source));

    expect(violations).toEqual([]);
  });
});

// ============================================================================
// 工作台组件
// ============================================================================

const appLogger = createTestLogger('phase-01/app');

const appInfo: AppInfo = {
  name: 'FrameForge',
  version: '0.1.0',
  electronVersion: '45.0.0',
  chromeVersion: '140.0.0',
  nodeVersion: '24.0.0',
  platform: 'win32',
  arch: 'x64',
};

describe('阶段 1 / 工作台组件', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'desktopAPI', {
      configurable: true,
      value: {
        getAppInfo: vi.fn().mockResolvedValue(appInfo),
        getFfmpegStatus: vi.fn().mockResolvedValue({
          available: false,
          ffmpegPath: null,
          ffprobePath: null,
          version: null,
          ffprobeVersion: null,
          source: null,
          error: '未找到 FFmpeg',
        }),
        selectVideos: vi.fn().mockResolvedValue([]),
        importVideos: vi.fn().mockResolvedValue([]),
        getPathForFile: vi.fn(() => ''),
        selectOutputDirectory: vi.fn().mockResolvedValue(null),
        startConversions: vi.fn().mockResolvedValue([]),
        cancelConversion: vi.fn().mockResolvedValue(undefined),
        onConversionUpdate: vi.fn(() => () => undefined),
        openOutputFile: vi.fn().mockResolvedValue(undefined),
        showOutputInFolder: vi.fn().mockResolvedValue(undefined),
        copyText: vi.fn().mockResolvedValue(undefined),
        openLogDirectory: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('渲染工作台，但不在主界面展示开发者运行环境', async () => {
    appLogger.info('STEP 渲染 App');
    render(<App />);

    appLogger.info('STEP 断言标题和空状态');
    expect(screen.getByText('FrameForge')).toBeInTheDocument();
    expect(screen.getByText('还没有导入视频')).toBeInTheDocument();

    appLogger.info('STEP 等待版本号，并确认环境面板已移除');
    expect(await screen.findByText('v0.1.0')).toBeInTheDocument();
    expect(screen.queryByText('运行环境')).not.toBeInTheDocument();
    expect(screen.queryByText('45.0.0')).not.toBeInTheDocument();
    expect(screen.queryByText('win32 · x64')).not.toBeInTheDocument();
  });

  it('应用信息读取失败时不阻塞工作台', async () => {
    Object.defineProperty(window, 'desktopAPI', {
      configurable: true,
      value: {
        getAppInfo: vi.fn().mockRejectedValue(new Error('IPC unavailable')),
        getFfmpegStatus: vi.fn().mockResolvedValue({
          available: false,
          ffmpegPath: null,
          ffprobePath: null,
          version: null,
          ffprobeVersion: null,
          source: null,
          error: '未找到 FFmpeg',
        }),
        selectVideos: vi.fn().mockResolvedValue([]),
        importVideos: vi.fn().mockResolvedValue([]),
        getPathForFile: vi.fn(() => ''),
        selectOutputDirectory: vi.fn().mockResolvedValue(null),
        startConversions: vi.fn().mockResolvedValue([]),
        cancelConversion: vi.fn().mockResolvedValue(undefined),
        onConversionUpdate: vi.fn(() => () => undefined),
        openOutputFile: vi.fn().mockResolvedValue(undefined),
        showOutputInFolder: vi.fn().mockResolvedValue(undefined),
        copyText: vi.fn().mockResolvedValue(undefined),
        openLogDirectory: vi.fn().mockResolvedValue(undefined),
      },
    });

    appLogger.info('STEP 让 getAppInfo 失败并渲染');
    render(<App />);

    appLogger.info('STEP 断言工作台仍可用，且不泄露内部错误面板');
    expect(screen.getByText('还没有导入视频')).toBeInTheDocument();
    expect(screen.queryByText('运行环境')).not.toBeInTheDocument();
    expect(screen.queryByText(/IPC unavailable/)).not.toBeInTheDocument();
  });
});

// ============================================================================
// IPC 调用方校验
// ============================================================================

const guardLogger = createTestLogger('phase-01/ipc-guard');

describe('阶段 1 / IPC 调用方校验', () => {
  it('接受当前主窗口的 webContents id', () => {
    guardLogger.info('STEP 使用相同 senderId 与 trustedId');
    expect(isTrustedSender(42, 42)).toBe(true);
  });

  it('拒绝其他 webContents id', () => {
    guardLogger.info('STEP 使用不同的 senderId 与 trustedId');
    expect(isTrustedSender(42, 7)).toBe(false);
  });

  it('主窗口未创建时拒绝所有调用', () => {
    guardLogger.info('STEP 模拟主窗口尚未创建（trustedId = null）');
    expect(isTrustedSender(42, null)).toBe(false);
  });
});
