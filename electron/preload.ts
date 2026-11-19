import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopAPI, OpenTarget, ScanBatch } from '../src/shared';
const api: DesktopAPI = {
  openFile: () => ipcRenderer.invoke('open-file'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  drop: files => ipcRenderer.invoke('drop', files.map(file => webUtils.getPathForFile(file))),
  scan: (path, id) => ipcRenderer.invoke('scan', path, id),
  cancelScan: id => ipcRenderer.invoke('cancel-scan', id),
  model: path => ipcRenderer.invoke('model', path),
  textureFolder: () => ipcRenderer.invoke('texture-folder'),
  background: () => ipcRenderer.invoke('background'),
  initial: () => ipcRenderer.invoke('initial'),
  onScan: callback => { const listener = (_: unknown, batch: ScanBatch) => callback(batch); ipcRenderer.on('scan-batch', listener); return () => ipcRenderer.removeListener('scan-batch', listener); },
  onOpen: callback => { const listener = (_: unknown, target: OpenTarget) => callback(target); ipcRenderer.on('open-target', listener); return () => ipcRenderer.removeListener('open-target', listener); },
};
contextBridge.exposeInMainWorld('desktop', api);
