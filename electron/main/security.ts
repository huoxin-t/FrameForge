import type { BrowserWindow } from 'electron';

export function isAllowedNavigation(allowedUrl: string, targetUrl: string): boolean {
  try {
    const allowed = new URL(allowedUrl);
    const target = new URL(targetUrl);

    return allowed.origin === target.origin && allowed.pathname === target.pathname;
  } catch {
    return false;
  }
}

export function hardenWindow(
  window: BrowserWindow,
  allowedUrl: string,
  onBlockedNavigation?: (url: string) => void,
): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(allowedUrl, url)) {
      event.preventDefault();
      onBlockedNavigation?.(url);
    }
  });
}
