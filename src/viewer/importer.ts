import * as THREE from 'three';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import type { ModelSource, Resource } from '../shared';
import { INPUTS, type TextureReference, type MaterialInfo } from './types';

export interface ImportedModel { root: THREE.Group; textures: TextureReference[]; materials: MaterialInfo[]; source: ModelSource; unit: string; warnings: string[]; dispose(): void; }
export function cloneDisplayTexture(source: THREE.Texture): THREE.Texture {
  const flags = source as THREE.Texture & { isDataTexture?: boolean; isCompressedTexture?: boolean };
  const clone = flags.isCompressedTexture ? new THREE.CompressedTexture([], 1, 1) : flags.isDataTexture ? new THREE.DataTexture() : new THREE.Texture();
  return clone.copy(source);
}
const normalize = (s: string) => s.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
export function candidatesFor(reference: string, catalog: Resource[]): Resource[] {
  const ref = normalize(reference), name = ref.split('/').pop();
  const exact = catalog.filter(item => normalize(item.relative) === ref || normalize(item.path) === ref);
  if (exact.length) return exact;
  const suffix = catalog.filter(item => ref.endsWith('/' + normalize(item.relative)));
  if (suffix.length === 1) return suffix;
  return catalog.filter(item => item.name.toLowerCase() === name);
}
export async function loadTextureReference(ref: TextureReference, resource: Resource) {
  const extension = resource.name.split('.').pop()?.toLowerCase();
  if (extension === 'tif' || extension === 'tiff') { ref.status = 'unsupported'; ref.error = 'TIFF decoding is unavailable. Choose a PNG or JPEG replacement.'; return; }
  try {
    const texture = extension === 'tga' ? await new TGALoader().loadAsync(resource.url) : extension === 'dds' ? await new DDSLoader().loadAsync(resource.url) : await new THREE.TextureLoader().loadAsync(resource.url);
    const target = ref.texture;
    // Drop any GPU allocation for the 1×1 missing-map placeholder before recovery.
    target.dispose();
    target.source = texture.source;
    Object.assign(target, { isDataTexture: 'isDataTexture' in texture, isCompressedTexture: 'isCompressedTexture' in texture });
    target.mipmaps = texture.mipmaps;
    target.format = texture.format; target.type = texture.type;
    target.minFilter = texture.minFilter; target.generateMipmaps = texture.generateMipmaps;
    if ('isCompressedTexture' in texture) { Object.assign(target, { isCompressedTexture: true, minFilter: texture.minFilter, generateMipmaps: false }); }
    if ('isDataTexture' in texture) Object.assign(target, { isDataTexture: true, unpackAlignment: 1 });
    target.flipY = texture.flipY;
    target.needsUpdate = true;
    ref.resolved = resource; ref.status = 'loaded'; ref.error = undefined;
    texture.dispose();
  } catch { ref.status = 'missing'; ref.error = `Cannot decode ${resource.name}`; }
}
export function describeMaterials(materials: THREE.Material[], refs: TextureReference[]): MaterialInfo[] {
  return materials.map(material => {
    const values = material as unknown as Record<string, unknown>;
    return { id: material.uuid, name: material.name || 'Unnamed material', type: material.type.replace('Mesh', '').replace('Material', ''), material, hasVertexColors: material.vertexColors, vertexColorsEnabled: material.vertexColors,
      inputs: INPUTS.map(input => {
        const texture = values[input.key] as THREE.Texture | undefined;
        const reference = texture ? refs.find(ref => ref.texture === texture) : undefined;
        const constant = input.constant ? values[input.constant] : undefined;
        const value = constant instanceof THREE.Color ? `#${constant.getHexString()}` : typeof constant === 'number' ? constant.toFixed(3).replace(/\.?0+$/, '') || '0' : undefined;
        return { ...input, texture, reference, status: texture ? reference?.status || 'loaded' : value !== undefined ? 'constant' : 'unassigned', value };
      }),
    };
  });
}
export async function importFBX(source: ModelSource, signal: AbortSignal): Promise<ImportedModel> {
  const response = await fetch(source.url, { signal });
  if (!response.ok) throw new Error('The model could not be read. Check its location and permissions.');
  const bytes = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
  const worker = new Worker(new URL('./fbx.worker.ts', import.meta.url), { type: 'module' });
  const parsed = await new Promise<{ json: THREE.Object3DJSON; metadata: { unitScale: number | null; upAxis: number }; embedded: Record<string, { bytes: ArrayBuffer; type: string }>; warnings: string[] }>((resolve, reject) => {
    const cancel = () => { worker.terminate(); reject(new DOMException('Import cancelled', 'AbortError')); };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = event => { signal.removeEventListener('abort', cancel); worker.terminate(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data); };
    worker.onerror = event => { signal.removeEventListener('abort', cancel); worker.terminate(); reject(new Error(event.message || 'FBX parser failed.')); };
    worker.postMessage(bytes, [bytes]);
  });
  const object = new THREE.ObjectLoader().parse(parsed.json) as THREE.Group;
  const root = new THREE.Group(); root.name = 'Asset'; root.add(object); root.animations = object.animations;
  let unit = 'file units';
  if (parsed.metadata.unitScale && parsed.metadata.unitScale > 0) { root.scale.setScalar(parsed.metadata.unitScale / 100); unit = 'm'; }
  if (parsed.metadata.upAxis === 2) root.rotation.x = -Math.PI / 2;
  if (parsed.metadata.upAxis === 0) root.rotation.z = Math.PI / 2;
  const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>();
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry); mesh.frustumCulled = false;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  const urls: string[] = [];
  const refs: TextureReference[] = [...textures].map(texture => ({ texture, reference: texture.userData.reference || texture.name || 'Unknown texture', status: 'missing', candidates: [] }));
  const dispose = () => { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); root.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) (node as THREE.SkinnedMesh).skeleton.dispose(); }); urls.forEach(url => URL.revokeObjectURL(url)); };
  try {
    await Promise.all(refs.map(async ref => {
      const embedded = parsed.embedded[ref.reference];
      if (embedded) { const url = URL.createObjectURL(new Blob([embedded.bytes], { type: embedded.type })); urls.push(url); await loadTextureReference(ref, { path: 'Embedded', relative: ref.texture.name, name: ref.texture.name || 'Embedded.png', url }); }
      else if (ref.reference.startsWith('data:')) await loadTextureReference(ref, { path: 'Embedded', relative: '', name: ref.texture.name || 'Embedded.png', url: ref.reference });
      else { ref.candidates = candidatesFor(ref.reference, source.textures); if (ref.candidates.length === 1) await loadTextureReference(ref, ref.candidates[0]); else ref.status = ref.candidates.length ? 'ambiguous' : 'missing'; }
    }));
    if (signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
    // A white placeholder lets imported constant colors remain visible until recovery.
    for (const ref of refs) if (ref.status !== 'loaded') { ref.texture.image = { data: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 }; Object.assign(ref.texture, { isDataTexture: true }); ref.texture.needsUpdate = true; }
    return { root, textures: refs, materials: describeMaterials([...materials], refs), source, unit, warnings: [...source.warnings, ...new Set(parsed.warnings)], dispose };
  } catch (error) { dispose(); throw error; }
}
