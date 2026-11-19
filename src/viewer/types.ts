import type * as THREE from 'three';
import type { Resource } from '../shared';
export type ViewMode = 'solid' | 'wireframe' | 'rendered' | 'map';
export type Channel = 'RGB' | 'R' | 'G' | 'B' | 'A';
export type InputKey = 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'emissiveMap' | 'alphaMap' | 'bumpMap' | 'specularMap';
export const INPUTS: { key: InputKey; label: string; channel?: string; constant?: string }[] = [
  { key: 'map', label: 'Base color', constant: 'color' }, { key: 'normalMap', label: 'Normal' },
  { key: 'roughnessMap', label: 'Roughness', channel: 'G', constant: 'roughness' },
  { key: 'metalnessMap', label: 'Metallic', channel: 'B', constant: 'metalness' },
  { key: 'aoMap', label: 'Ambient occlusion', channel: 'R' },
  { key: 'emissiveMap', label: 'Emissive', constant: 'emissive' },
  { key: 'alphaMap', label: 'Opacity', channel: 'G', constant: 'opacity' },
  { key: 'bumpMap', label: 'Bump' }, { key: 'specularMap', label: 'Specular', constant: 'specular' },
];
export interface TextureReference { texture: THREE.Texture; reference: string; status: 'loaded' | 'missing' | 'ambiguous' | 'unsupported'; candidates: Resource[]; resolved?: Resource; error?: string; }
export interface MaterialInput { key: InputKey; label: string; status: 'loaded' | 'constant' | 'missing' | 'ambiguous' | 'unassigned' | 'unsupported'; value?: string; texture?: THREE.Texture; reference?: TextureReference; channel?: string; }
export interface MaterialInfo { id: string; name: string; type: string; material: THREE.Material; inputs: MaterialInput[]; hasVertexColors: boolean; vertexColorsEnabled: boolean; }
export interface MeshInfo { id: string; name: string; triangles: number; materials: string[]; visible: boolean; }
export interface ModelInfo { name: string; path: string; meshes: MeshInfo[]; materials: MaterialInfo[]; clips: { name: string; duration: number }[]; triangles: number; dimensions: [number, number, number]; unit: string; hasSkeleton: boolean; warnings: string[]; }
export interface LightSettings { id: string; name: string; type: 'point' | 'directional'; enabled: boolean; color: string; intensity: number; position: [number, number, number]; rotation: [number, number, number]; range: number; }
export interface BackgroundSettings { type: 'solid' | 'gradient' | 'image'; color: string; bottom: string; image?: Resource; fit: 'fit' | 'fill'; }
export const DEFAULT_BACKGROUND: BackgroundSettings = { type: 'gradient', color: '#333940', bottom: '#1e2228', fit: 'fill' };
export interface Playback { clip: number; playing: boolean; loop: boolean; speed: number; time: number; duration: number; }
export interface ViewerEvents { select: (meshId: string | null, materialId: string | null) => void; lightSelect: (id: string) => void; lightChange: (light: LightSettings) => void; playback: (playback: Playback) => void; }
