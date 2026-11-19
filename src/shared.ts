export const RECOGNIZED_EXTENSIONS = ['fbx', 'obj', 'glb', 'gltf', 'blend', 'dae', '3ds', 'stl', 'ply', 'usd', 'usda', 'usdc', 'usdz'] as const;
export const IMPORTERS: Record<string, string> = { fbx: 'FBX' };
export interface Asset { path: string; relative: string; name: string; extension: string; size: number; }
export interface ScanBatch { id: string; root: string; files: Asset[]; done: boolean; warnings: string[]; }
export interface Resource { path: string; relative: string; name: string; url: string; }
export interface ModelSource { path: string; name: string; url: string; textures: Resource[]; warnings: string[]; }
export interface OpenTarget { path: string; kind: 'file' | 'folder'; }
export interface DesktopAPI {
  openFile(): Promise<OpenTarget | null>;
  openFolder(): Promise<OpenTarget | null>;
  drop(files: File[]): Promise<OpenTarget[]>;
  scan(path: string, id: string): Promise<void>;
  cancelScan(id: string): Promise<void>;
  model(path: string): Promise<ModelSource>;
  textureFolder(): Promise<Resource[] | null>;
  background(): Promise<Resource | null>;
  onScan(callback: (batch: ScanBatch) => void): () => void;
  onOpen(callback: (target: OpenTarget) => void): () => void;
  initial(): Promise<OpenTarget | null>;
}
declare global { interface Window { desktop: DesktopAPI; } }
