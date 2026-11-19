import { LoadingManager, Loader, Texture, type Object3D } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Image decoding is deferred to the renderer. This keeps parsing off the UI thread,
// and retains the FBX hierarchy, skeletons, animation tracks and texture transforms.
const blobs = new Map<string, Blob>();
const createObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob) => { const url = createObjectURL(blob); blobs.set(url, blob); return url; };
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
class DeferredTextures extends Loader<Texture> {
  load(url: string) { const texture = new Texture(); texture.image = { data: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 }; texture.userData.reference = url; return texture; }
}
function metadata(buffer: ArrayBuffer): { unitScale: number | null; upAxis: number } {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  let unitScale: number | null = null, upAxis = 1;
  if (decoder.decode(bytes.slice(0, 18)).startsWith('Kaydara FBX Binary')) {
    const view = new DataView(buffer), wide = view.getUint32(23, true) >= 7500;
    const readOffset = (offset: number) => wide ? Number(view.getBigUint64(offset, true)) : view.getUint32(offset, true);
    const word = wide ? 8 : 4;
    const properties = (start: number, count: number) => {
      let pos = start; const values: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const type = String.fromCharCode(view.getUint8(pos++));
        if (type === 'S' || type === 'R') { const len = view.getUint32(pos, true); pos += 4; values.push(type === 'S' ? decoder.decode(bytes.subarray(pos, pos + len)) : null); pos += len; }
        else if (type === 'D') { values.push(view.getFloat64(pos, true)); pos += 8; }
        else if (type === 'F') { values.push(view.getFloat32(pos, true)); pos += 4; }
        else if (type === 'I') { values.push(view.getInt32(pos, true)); pos += 4; }
        else if (type === 'L') { values.push(Number(view.getBigInt64(pos, true))); pos += 8; }
        else if (type === 'Y') { values.push(view.getInt16(pos, true)); pos += 2; }
        else if (type === 'C') { values.push(view.getUint8(pos++)); }
        else break;
      }
      return values;
    };
    const visit = (start: number, end: number, global = false) => {
      let pos = start;
      while (pos + word * 3 + 1 < end) {
        const next = readOffset(pos); if (!next || next <= pos || next > end) break;
        const count = readOffset(pos + word), size = readOffset(pos + word * 2);
        const nameLen = view.getUint8(pos + word * 3), dataStart = pos + word * 3 + 1 + nameLen;
        const name = decoder.decode(bytes.subarray(pos + word * 3 + 1, dataStart));
        if (name === 'GlobalSettings' || (global && name === 'Properties70')) visit(dataStart + size, next, true);
        if (global && name === 'P') {
          const props = properties(dataStart, count);
          if (props[0] === 'UnitScaleFactor' && typeof props[4] === 'number') unitScale = props[4];
          if (props[0] === 'UpAxis' && typeof props[4] === 'number') upAxis = props[4];
        }
        pos = next;
      }
    };
    try { visit(27, buffer.byteLength); } catch { /* Unknown metadata: retain file units. */ }
  } else {
    const text = decoder.decode(bytes);
    const unit = text.match(/P:\s*"UnitScaleFactor"[^\r\n]*,\s*([-\d.e+]+)\s*$/mi);
    const up = text.match(/P:\s*"UpAxis"[^\r\n]*,\s*(\d+)\s*$/mi);
    if (unit) unitScale = Number(unit[1]); if (up) upAxis = Number(up[1]);
  }
  return { unitScale, upAxis };
}
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  const warnings: string[] = [];
  const oldWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    const manager = new LoadingManager();
    manager.addHandler(/.*/, new DeferredTextures(manager));
    const loader = new FBXLoader(manager);
    const root: Object3D = loader.parse(event.data, '');
    for (const clip of root.animations) {
      const firstTime = Math.min(...clip.tracks.filter(track => track.times.length).map(track => track.times[0]));
      if (Number.isFinite(firstTime) && firstTime > 0) { clip.tracks.forEach(track => track.shift(-firstTime)); clip.resetDuration(); }
    }
    const json = root.toJSON();
    const embedded: Record<string, { bytes: ArrayBuffer; type: string }> = {};
    for (const [url, blob] of blobs) embedded[url] = { bytes: await blob.arrayBuffer(), type: blob.type };
    self.postMessage({ json, embedded, metadata: metadata(event.data), warnings }, { transfer: Object.values(embedded).map(e => e.bytes) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { console.warn = oldWarn; for (const url of blobs.keys()) URL.revokeObjectURL(url); blobs.clear(); }
};
