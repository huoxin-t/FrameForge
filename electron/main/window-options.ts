import type { BrowserWindowConstructorOptions } from 'electron';

export interface WindowOptionsInput {
  preloadPath: string;
  isPackaged: boolean;
}

export function createWindowOptions(input: WindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    title: 'FrameForge',
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !input.isPackaged,
    },
  };
}
