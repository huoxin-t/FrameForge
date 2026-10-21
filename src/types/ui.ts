import type { AppInfo } from '../../shared/ipc';
import type { FfmpegStatus } from '../../shared/media';

export type AppInfoState =
  | { status: 'loading' }
  | { status: 'ready'; info: AppInfo }
  | { status: 'error'; message: string };

export type FfmpegState =
  | { status: 'loading' }
  | { status: 'ready'; info: FfmpegStatus }
  | { status: 'error'; message: string };
