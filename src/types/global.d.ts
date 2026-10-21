import type { DesktopAPI } from '../../shared/ipc';

declare global {
  interface Window {
    desktopAPI: DesktopAPI;
  }
}

export {};
