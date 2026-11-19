import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, nativeTheme } from 'electron';
import { readdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { RECOGNIZED_EXTENSIONS, type Asset, type OpenTarget, type Resource, type ScanBatch } from '../src/shared';

protocol.registerSchemesAsPrivileged([{ scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let window: BrowserWindow;
let pending: OpenTarget | null = null;
const roots = new Set<string>();
const browseRoots = new Set<string>();
const textureCatalogs = new Map<string, ReturnType<typeof textures>>();
const resources = new Map<string, string>();
const resourceIds = new Map<string, string>();
const scans = new Set<string>();
const recognized = new Set<string>(RECOGNIZED_EXTENSIONS);
const textureTypes = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tga', '.tif', '.tiff', '.dds']);
const normalized = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
async function grant(p: string): Promise<OpenTarget> {
  const actual = await realpath(p);
  const info = await stat(actual);
  if (!info.isDirectory() && !info.isFile()) throw new Error('Select a file or folder.');
  roots.add(normalized(info.isDirectory() ? actual : path.dirname(actual)));
  if (info.isDirectory()) browseRoots.add(actual);
  return { path: actual, kind: info.isDirectory() ? 'folder' : 'file' };
}
async function authorized(p: string) {
  const actual = await realpath(p);
  const canonical = normalized(actual);
  if (![...roots].some(root => canonical === root || canonical.startsWith(root + path.sep))) throw new Error('Open this location using Open File or Open Folder first.');
  return actual;
}
function resource(p: string, root = path.dirname(p)): Resource {
  let id = resourceIds.get(p);
  if (!id) { id = randomUUID(); resources.set(id, p); resourceIds.set(p, id); }
  return { path: p, name: path.basename(p), relative: path.relative(root, p).replaceAll('\\', '/'), url: `asset://${id}/${encodeURIComponent(path.basename(p))}` };
}
async function walk(root: string, visit: (p: string) => Promise<void>, warnings: string[], cancelled = () => false) {
  const queue = [root];
  while (queue.length && !cancelled()) {
    const folder = queue.pop()!;
    try {
      const entries = await readdir(folder, { withFileTypes: true });
      for (const entry of entries) {
        if (cancelled()) return;
        const p = path.join(folder, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { if (!['node_modules', '.git', '$RECYCLE.BIN'].includes(entry.name)) queue.push(p); }
        else if (entry.isFile()) await visit(p);
      }
    } catch { warnings.push(`Cannot read ${path.relative(root, folder) || folder}`); }
  }
}
async function textures(root: string) {
  const files: Resource[] = [], warnings: string[] = [];
  await walk(root, async p => { if (textureTypes.has(path.extname(p).toLowerCase())) files.push(resource(p, root)); }, warnings);
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  return { files, warnings };
}
async function choose(kind: 'file' | 'folder') {
  const result = await dialog.showOpenDialog(window, kind === 'folder' ? { title: 'Open Asset Folder', properties: ['openDirectory'] } : {
    title: 'Open Model', properties: ['openFile'], filters: [{ name: 'FBX models', extensions: ['fbx'] }, { name: '3D assets', extensions: [...RECOGNIZED_EXTENSIONS] }],
  });
  return result.canceled ? null : grant(result.filePaths[0]);
}
function sendOpen(target: OpenTarget | null) { if (target) window.webContents.send('open-target', target); }

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  protocol.handle('asset', async request => {
    const file = resources.get(new URL(request.url).hostname);
    if (!file) return new Response('Resource unavailable', { status: 404 });
    try { return await net.fetch(pathToFileURL(await authorized(file)).toString()); }
    catch { return new Response('Resource unavailable', { status: 404 }); }
  });
  ipcMain.handle('open-file', () => choose('file'));
  ipcMain.handle('open-folder', () => choose('folder'));
  ipcMain.handle('drop', async (_event, paths: string[]) => {
    if (!Array.isArray(paths) || paths.length > 100) throw new Error('Drop one folder or model at a time.');
    return Promise.all(paths.map(p => grant(p)));
  });
  ipcMain.handle('initial', () => { const target = pending; pending = null; return target; });
  ipcMain.handle('cancel-scan', (_event, id: string) => { scans.delete(id); });
  ipcMain.handle('scan', async (_event, root: string, id: string) => {
    root = await authorized(root);
    textureCatalogs.delete(root);
    scans.add(id);
    let batch: Asset[] = [];
    const warnings: string[] = [];
    let lastFlush = Date.now();
    const emit = (done: boolean) => {
      if (!window.isDestroyed()) window.webContents.send('scan-batch', { id, root, files: batch, done, warnings: done ? warnings : [] } satisfies ScanBatch);
      batch = []; lastFlush = Date.now();
    };
    await walk(root, async p => {
      const extension = path.extname(p).slice(1).toLowerCase();
      if (!recognized.has(extension)) return;
      try { batch.push({ path: p, relative: path.relative(root, p).replaceAll('\\', '/'), name: path.basename(p), extension, size: (await stat(p)).size }); }
      catch { warnings.push(`Cannot read ${p}`); }
      if (batch.length >= 100 || Date.now() - lastFlush > 150) emit(false);
    }, warnings, () => !scans.has(id));
    if (scans.has(id)) { emit(true); scans.delete(id); }
  });
  ipcMain.handle('model', async (_event, p: string) => {
    p = await authorized(p);
    if (path.extname(p).toLowerCase() !== '.fbx') throw new Error('Preview unavailable for this format.');
    const info = await stat(p);
    if (info.size > 1024 * 1024 * 1024) throw new Error('This model exceeds the 1 GB import limit.');
    const searchRoot = [...browseRoots].filter(root => normalized(p).startsWith(normalized(root) + path.sep)).sort((a, b) => b.length - a.length)[0] || path.dirname(p);
    if (!textureCatalogs.has(searchRoot)) textureCatalogs.set(searchRoot, textures(searchRoot));
    const catalog = await textureCatalogs.get(searchRoot)!;
    return { path: p, name: path.basename(p), url: resource(p).url, textures: catalog.files, warnings: catalog.warnings };
  });
  ipcMain.handle('texture-folder', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Locate Texture Folder', properties: ['openDirectory'] });
    if (result.canceled) return null;
    const target = await grant(result.filePaths[0]);
    return (await textures(target.path)).files;
  });
  ipcMain.handle('background', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open Background Image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (result.canceled) return null;
    const target = await grant(result.filePaths[0]);
    return resource(target.path);
  });
  window = new BrowserWindow({ width: 1580, height: 980, minWidth: 1080, minHeight: 700, title: 'FBX Viewer', backgroundColor: '#17191d',
    autoHideMenuBar: true, titleBarStyle: 'hidden', titleBarOverlay: { color: '#191c21', symbolColor: '#b9c0cb', height: 42 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: async () => sendOpen(await choose('file')) },
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: async () => sendOpen(await choose('folder')) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  ]));
  const fileArg = process.argv.find(a => /\.fbx$/i.test(a));
  if (fileArg) { try { pending = await grant(path.resolve(fileArg)); } catch { /* UI still opens if the argument is invalid. */ } }
  if (process.env.VITE_DEV_SERVER_URL) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(path.join(__dirname, '../dist/index.html'));
});
app.on('window-all-closed', () => app.quit());
