import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('drawnixDesktop', {
  platform: process.platform,
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  openFiles: (options?: {
    description?: string;
    extensions?: string[];
    multiple?: boolean;
  }) => ipcRenderer.invoke('dialog:open-file', options),

  writeFile: (filePath: string, data: Uint8Array) =>
    ipcRenderer.invoke('file:write', { path: filePath, data }),

  saveFileAs: (payload: {
    defaultPath?: string;
    description?: string;
    extension: string;
    data: Uint8Array;
  }): Promise<string | null> => ipcRenderer.invoke('file:save-as', payload),

  ready: (): Promise<{ path: string; content: string } | null> =>
    ipcRenderer.invoke('app:renderer-ready'),

  onOpenFile: (callback: (payload: { path: string; content: string }) => void) => {
    const listener = (_event: unknown, payload: { path: string; content: string }) =>
      callback(payload);
    ipcRenderer.on('app:open-file', listener);
    return () => ipcRenderer.removeListener('app:open-file', listener);
  },
});
