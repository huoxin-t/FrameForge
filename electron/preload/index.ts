import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from 'electron';
import { createDesktopApi } from './api';

const api = createDesktopApi(
  (channel, payload) => ipcRenderer.invoke(channel, payload),
  (channel, listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => {
      listener(payload);
    };

    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
);

contextBridge.exposeInMainWorld('desktopAPI', api);
