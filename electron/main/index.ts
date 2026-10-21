import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerIpcHandlers } from './ipc/handlers';
import { runMain } from './orchestrator';
import { hardenWindow } from './security';
import { createCloseGuard } from './services/close-guard';
import type { ConversionQueue } from './services/conversion/queue';
import { createLogger, getLogFilePath } from './services/logger';
import { createWindowOptions } from './window-options';

const logger = createLogger('main');

let mainWindow: BrowserWindow | null = null;
let conversionQueue: ConversionQueue | null = null;

async function initLogger(): Promise<void> {
  logger.info('Logger initialized', { logFile: getLogFilePath() });
}

async function createMainWindow(): Promise<void> {
  logger.info('Creating main window');

  const window = new BrowserWindow(
    createWindowOptions({
      preloadPath: join(__dirname, '../preload/index.js'),
      isPackaged: app.isPackaged,
    }),
  );

  mainWindow = window;

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
    logger.info('Main window closed');
  });

  window.once('ready-to-show', () => {
    window.show();
    logger.info('Main window shown');
  });

  const handleClose = createCloseGuard({
    hasActiveJobs: () => conversionQueue?.hasActiveJobs() ?? false,
    confirmExit: async () => {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: '仍有转换任务',
        message: '还有任务正在排队或转换中',
        detail: '关闭窗口会取消这些任务，并清理未完成的临时文件。',
        buttons: ['取消任务并退出', '继续转换'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      return result.response === 0;
    },
    cancelAll: () => conversionQueue?.cancelAll(),
    waitForIdle: async () => {
      await conversionQueue?.waitForIdle();
    },
    closeWindow: () => {
      if (!window.isDestroyed()) {
        window.close();
      }
    },
    onError: (error) => {
      logger.error('Failed to close window while canceling tasks', { error });
    },
  });

  window.on('close', (event) => {
    void handleClose(event);
  });

  const developmentUrl = process.env['ELECTRON_RENDERER_URL'];
  const rendererFile = join(__dirname, '../renderer/index.html');
  const targetUrl = developmentUrl ?? pathToFileURL(rendererFile).toString();

  hardenWindow(window, targetUrl, (blockedUrl) => {
    logger.warn('Blocked untrusted navigation', { blockedUrl });
  });

  logger.info('Loading renderer', { url: targetUrl });

  if (developmentUrl) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(rendererFile);
  }

  logger.info('Main window loaded');
}

function registerAppLifecycle(): void {
  app.on('window-all-closed', () => {
    logger.info('All windows closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow().catch((error: unknown) => {
        logger.error('Failed to recreate main window', { error });
      });
    }
  });

  logger.info('App lifecycle registered');
}

async function main(): Promise<void> {
  await app.whenReady();
  logger.info('FrameForge starting', {
    version: app.getVersion(),
    packaged: app.isPackaged,
  });

  await runMain({
    initLogger,
    registerIpcHandlers: () => {
      const registered = registerIpcHandlers(() => mainWindow);
      conversionQueue = registered.conversion;
    },
    createMainWindow,
    registerAppLifecycle,
  });

  logger.info('FrameForge startup complete');
}

void main().catch((error: unknown) => {
  logger.error('FrameForge failed to start', { error });
  app.quit();
});
