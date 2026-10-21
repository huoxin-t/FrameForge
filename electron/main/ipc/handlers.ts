import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { dirname } from 'node:path';
import { VIDEO_EXTENSIONS } from '../../../shared/media';
import { IPC_CHANNELS } from '../../../shared/ipc';
import type { ConversionUpdate } from '../../../shared/conversion';
import { buildAppInfo } from '../services/app-info';
import { FfmpegService } from '../services/ffmpeg/status';
import { resolveFfmpegPaths } from '../services/ffmpeg/resolver';
import {
  createMediaService,
  type MediaService,
} from '../services/media/media-service';
import {
  createConversionQueue,
  type ConversionQueue,
} from '../services/conversion/queue';
import {
  parseClipboardText,
  parseJobId,
  parseStartConversionsRequest,
} from '../services/conversion/validation';
import {
  openCompletedOutput,
  revealCompletedOutput,
} from '../services/conversion/output-actions';
import { parseVideoPaths } from '../services/media/import-validation';
import { createLogger, getLogFilePath } from '../services/logger';
import { openExistingDirectory } from '../services/system/open-path';
import { pathExists } from '../services/system/path-exists';
import { isTrustedSender } from './guard';

const logger = createLogger('ipc');

export interface IpcServices {
  ffmpeg: FfmpegService;
  media: MediaService;
  conversion?: ConversionQueue;
}

export interface RegisteredIpcHandlers {
  conversion: ConversionQueue;
}

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  services: Partial<IpcServices> = {},
): RegisteredIpcHandlers {
  const ffmpegService =
    services.ffmpeg ??
    new FfmpegService({
      resolvePaths: () =>
        resolveFfmpegPaths({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
        }),
    });
  const mediaService = services.media ?? createMediaService(ffmpegService);

  const sendConversionUpdate = (update: ConversionUpdate) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send(IPC_CHANNELS.conversionUpdate, update);
  };

  const conversionQueue =
    services.conversion ??
    createConversionQueue({
      ffmpeg: ffmpegService,
      onUpdate: sendConversionUpdate,
    });

  const assertTrusted = (event: IpcMainInvokeEvent, channel: string) => {
    const mainWindow = getMainWindow();
    const trustedWebContentsId = mainWindow?.webContents.id ?? null;

    if (!isTrustedSender(event.sender.id, trustedWebContentsId)) {
      logger.error('Rejected IPC request from untrusted sender', {
        channel,
        senderId: event.sender.id,
        trustedWebContentsId,
      });
      throw new Error('Untrusted IPC sender');
    }
  };

  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(IPC_CHANNELS.getAppInfo, (event) => {
    assertTrusted(event, IPC_CHANNELS.getAppInfo);
    logger.info('Handled IPC request', { channel: IPC_CHANNELS.getAppInfo });

    return buildAppInfo({
      version: app.getVersion(),
      versions: process.versions,
      platform: process.platform,
      arch: process.arch,
    });
  });

  ipcMain.handle(IPC_CHANNELS.getFfmpegStatus, async (event) => {
    assertTrusted(event, IPC_CHANNELS.getFfmpegStatus);
    logger.info('Handled IPC request', {
      channel: IPC_CHANNELS.getFfmpegStatus,
    });
    return ffmpegService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.selectVideos, async (event) => {
    assertTrusted(event, IPC_CHANNELS.selectVideos);

    const mainWindow = getMainWindow();
    if (!mainWindow) {
      throw new Error('主窗口不可用，无法打开文件选择器');
    }

    logger.info('Opening video selection dialog');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入视频',
      buttonLabel: '导入',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '视频文件',
          extensions: [...VIDEO_EXTENSIONS],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      logger.info('Video selection canceled');
      return [];
    }

    logger.info('Video files selected', { count: result.filePaths.length });
    logger.debug('Selected video paths', { paths: result.filePaths });

    return mediaService.importFiles(result.filePaths);
  });

  ipcMain.handle(IPC_CHANNELS.importPaths, async (event, paths: unknown) => {
    assertTrusted(event, IPC_CHANNELS.importPaths);
    const parsed = parseVideoPaths(paths);
    logger.info('Importing video files from drag and drop', {
      count: parsed.length,
    });
    logger.debug('Dropped video paths', { paths: parsed });

    return mediaService.importFiles(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.selectOutputDirectory, async (event) => {
    assertTrusted(event, IPC_CHANNELS.selectOutputDirectory);

    const mainWindow = getMainWindow();
    if (!mainWindow) {
      throw new Error('主窗口不可用，无法打开目录选择器');
    }

    logger.info('Opening output directory dialog');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择输出目录',
      buttonLabel: '选择此目录',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      logger.info('Output directory selection canceled');
      return null;
    }

    logger.info('Output directory selected', { path: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.startConversions, async (event, request: unknown) => {
    assertTrusted(event, IPC_CHANNELS.startConversions);
    const parsed = parseStartConversionsRequest(request);
    logger.info('Handled conversion start', {
      count: parsed.sourcePaths.length,
      format: parsed.settings.format,
      qualityPreset: parsed.settings.qualityPreset,
    });

    return conversionQueue.enqueue(parsed.sourcePaths, parsed.settings);
  });

  ipcMain.handle(IPC_CHANNELS.cancelConversion, (event, jobId: unknown) => {
    assertTrusted(event, IPC_CHANNELS.cancelConversion);
    const parsed = parseJobId(jobId);
    logger.info('Handled conversion cancel', { jobId: parsed });
    conversionQueue.cancel(parsed);
  });

  const outputActionDependencies = {
    openPath: (path: string) => shell.openPath(path),
    showItemInFolder: (path: string) => shell.showItemInFolder(path),
    pathExists,
  };

  ipcMain.handle(IPC_CHANNELS.openOutputFile, async (event, jobId: unknown) => {
    assertTrusted(event, IPC_CHANNELS.openOutputFile);
    const parsed = parseJobId(jobId);
    logger.info('Opening completed output file', { jobId: parsed });
    await openCompletedOutput(
      conversionQueue.getJob(parsed),
      outputActionDependencies,
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.showOutputInFolder,
    async (event, jobId: unknown) => {
      assertTrusted(event, IPC_CHANNELS.showOutputInFolder);
      const parsed = parseJobId(jobId);
      logger.info('Revealing completed output in folder', { jobId: parsed });
      await revealCompletedOutput(
        conversionQueue.getJob(parsed),
        outputActionDependencies,
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.copyText, (event, text: unknown) => {
    assertTrusted(event, IPC_CHANNELS.copyText);
    const parsed = parseClipboardText(text);
    clipboard.writeText(parsed);
    logger.info('Copied text to clipboard', { length: parsed.length });
  });

  ipcMain.handle(IPC_CHANNELS.openLogDirectory, async (event) => {
    assertTrusted(event, IPC_CHANNELS.openLogDirectory);
    const logDirectory = dirname(getLogFilePath());
    logger.info('Opening log directory', { path: logDirectory });
    await openExistingDirectory(logDirectory, {
      openPath: (path) => shell.openPath(path),
      pathExists,
    });
  });

  logger.info('IPC handlers registered', {
    channels: Object.values(IPC_CHANNELS),
  });

  // 启动时预热 FFmpeg 状态，便于顶栏和设置区尽快显示真实环境。
  void ffmpegService
    .getStatus()
    .then((status) => {
      logger.info('FFmpeg status available to IPC', {
        available: status.available,
        version: status.version,
        source: status.source,
      });
    })
    .catch((error: unknown) => {
      logger.error('Failed to warm FFmpeg status', { error });
    });

  return { conversion: conversionQueue };
}
