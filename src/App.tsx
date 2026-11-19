import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Axis3D, Bone, Box, ChevronDown, ChevronRight, Crosshair, FileBox, FolderOpen, Grid2X2, Image, Layers3, Lightbulb, Maximize, PanelLeft, PanelRight, Plus, Sun, X } from 'lucide-react';
import { AssetBrowser } from './components/AssetBrowser';
import { Inspector, type InspectorTarget } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { IconButton } from './components/Controls';
import { IMPORTERS, type Asset, type OpenTarget, type Resource } from './shared';
import { Viewer } from './viewer/Viewer';
import { candidatesFor, importFBX, loadTextureReference } from './viewer/importer';
import { DEFAULT_BACKGROUND, type BackgroundSettings, type Channel, type InputKey, type LightSettings, type ModelInfo, type Playback, type TextureReference, type ViewMode } from './viewer/types';

const initialPlayback: Playback = { clip: 0, playing: false, loop: true, speed: 1, time: 0, duration: 0 };
const messageOf = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error);
export default function App() {
  const host = useRef<HTMLDivElement>(null), viewer = useRef<Viewer | null>(null), modelRef = useRef<ModelInfo | null>(null), loadController = useRef<AbortController | null>(null), scanId = useRef('');
  const [model, setModel] = useState<ModelInfo | null>(null), [assets, setAssets] = useState<Asset[]>([]), [root, setRoot] = useState(''), [scanning, setScanning] = useState(false), [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null), [selectedMesh, setSelectedMesh] = useState<string | null>(null), [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [dropActive, setDropActive] = useState(false), [ready, setReady] = useState(false);
  const [mode, setMode] = useState<ViewMode>('rendered'), [wireOverlay, setWireOverlay] = useState(false), [grid, setGrid] = useState(true), [axes, setAxes] = useState(true), [skeleton, setSkeleton] = useState(false);
  const [map, setMap] = useState<InputKey | null>(null), [channel, setChannel] = useState<Channel>('RGB'), [target, setTarget] = useState<InspectorTarget>('material');
  const [leftOpen, setLeftOpen] = useState(true), [rightOpen, setRightOpen] = useState(true), [leftWidth, setLeftWidth] = useState(278), [rightWidth, setRightWidth] = useState(310);
  const [lights, setLights] = useState<LightSettings[]>([]), [selectedLight, setSelectedLight] = useState<string | null>(null), [helpers, setHelpers] = useState(true), [lightTool, setLightTool] = useState<'translate' | 'rotate'>('translate');
  const [background, setBackground] = useState<BackgroundSettings>(DEFAULT_BACKGROUND), [environment, setEnvironment] = useState({ rotation: 0, intensity: 1, exposure: 1 });
  const [playback, setPlayback] = useState(initialPlayback), [locating, setLocating] = useState(false), [menu, setMenu] = useState<'file' | 'light' | null>(null);
  const additionalTextures = useRef<Resource[]>([]), lightCount = useRef({ point: 0, directional: 0 }), dragDepth = useRef(0);
  const updateModel = useCallback((next: ModelInfo | null) => { modelRef.current = next; setModel(next); }, []);
  const selectLight = useCallback((id: string) => { setSelectedLight(id); setTarget('light'); setRightOpen(true); viewer.current?.selectLight(id); }, []);
  const selectMesh = (id: string) => { const mesh = model?.meshes.find(mesh => mesh.id === id); setSelectedMesh(id); setSelectedMaterial(mesh?.materials[0] || null); setSelectedLight(null); setTarget('mesh'); setRightOpen(true); viewer.current?.selectMesh(id); };
  const setInspectorTarget = (value: InspectorTarget) => { setTarget(value); setRightOpen(true); if (value !== 'light') viewer.current?.selectLight(null); };

  useEffect(() => {
    if (!host.current) return;
    try {
      viewer.current = new Viewer(host.current, {
        select: (mesh, material) => { setSelectedMesh(mesh); setSelectedMaterial(material); setSelectedLight(null); if (mesh) { setTarget('material'); setRightOpen(true); } },
        lightSelect: selectLight,
        lightChange: light => setLights(previous => previous.map(item => item.id === light.id ? light : item)),
        playback: setPlayback,
      }); setReady(true);
    } catch (error) { setError(`Cannot start the 3D viewport: ${messageOf(error)}`); }
    return () => { loadController.current?.abort(); viewer.current?.dispose(); viewer.current = null; };
  }, [selectLight]);
  const chooseMode = (value: ViewMode) => { setMode(value); viewer.current?.setMode(value, wireOverlay); if (value === 'map') { setInspectorTarget('material'); if (!map) setNotice('Select a loaded material input to inspect its texture.'); } };
  const openAsset = useCallback(async (asset: Pick<Asset, 'path' | 'name' | 'extension'>) => {
    setSelectedAsset(asset.path); setError(''); setNotice('');
    loadController.current?.abort();
    if (!IMPORTERS[asset.extension]) { setBusy(''); setNotice(`Preview unavailable for .${asset.extension.toUpperCase()}.`); return; }
    const controller = new AbortController(); loadController.current = controller; setBusy(asset.name);
    try {
      const source = await window.desktop.model(asset.path);
      if (controller.signal.aborted) return;
      source.textures = [...source.textures, ...additionalTextures.current.filter(resource => !source.textures.some(item => item.path === resource.path))];
      const imported = await importFBX(source, controller.signal);
      if (controller.signal.aborted || !viewer.current) { imported.dispose(); return; }
      const info = viewer.current.setModel(imported); updateModel(info);
      setSelectedMesh(info.meshes[0]?.id || null); setSelectedMaterial(info.materials[0]?.id || null); setSelectedLight(null); setMap(null); setChannel('RGB'); setSkeleton(info.meshes.length === 0 && info.hasSkeleton); setTarget('material');
      setMode(previous => previous === 'map' ? 'rendered' : previous);
      if (!info.meshes.length) setNotice(info.hasSkeleton ? 'This FBX contains a skeleton and animation without a preview mesh.' : 'This FBX has no previewable geometry.');
    } catch (error) { if (!controller.signal.aborted) setError(`Could not open ${asset.name}. ${messageOf(error)}`); }
    finally { if (!controller.signal.aborted) setBusy(''); }
  }, [updateModel]);
  const startScan = useCallback(async (path: string, refresh = false) => {
    if (scanId.current) void window.desktop.cancelScan(scanId.current);
    const id = crypto.randomUUID(); scanId.current = id; setRoot(path); setScanning(true); setScanWarnings([]); setError('');
    // Keep the old list visible during Refresh; replace it once the first batch arrives.
    if (!refresh) setAssets([]);
    let first = true;
    const unsubscribe = window.desktop.onScan(batch => {
      if (batch.id !== id || scanId.current !== id) return;
      const reset = first; first = false;
      setAssets(previous => [...(reset ? [] : previous), ...batch.files].sort((a, b) => a.relative.localeCompare(b.relative, undefined, { numeric: true, sensitivity: 'base' })));
      if (batch.done) { setScanning(false); setScanWarnings(batch.warnings); unsubscribe(); }
    });
    try { await window.desktop.scan(path, id); } catch (error) { if (scanId.current === id) { setError(messageOf(error)); setScanning(false); } unsubscribe(); }
    finally { if (scanId.current !== id) unsubscribe(); }
  }, []);
  const handleTarget = useCallback((target: OpenTarget | null) => { if (!target) return; if (target.kind === 'folder') void startScan(target.path); else void openAsset({ path: target.path, name: target.path.split(/[\\/]/).pop()!, extension: target.path.split('.').pop()!.toLowerCase() }); }, [startScan, openAsset]);
  useEffect(() => { if (!ready || !window.desktop) return; const unsubscribe = window.desktop.onOpen(handleTarget); void window.desktop.initial().then(handleTarget).catch(error => setError(messageOf(error))); return unsubscribe; }, [ready, handleTarget]);
  const openFile = async () => { setMenu(null); try { handleTarget(await window.desktop.openFile()); } catch (error) { setError(messageOf(error)); } };
  const openFolder = async () => { setMenu(null); try { handleTarget(await window.desktop.openFolder()); } catch (error) { setError(messageOf(error)); } };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input,select,textarea')) return;
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); viewer.current?.frame(); }
      if (event.key === ' ' && modelRef.current?.clips.length && (event.target as HTMLElement).tagName === 'CANVAS') { event.preventDefault(); viewer.current?.play(!viewer.current.playback.playing); }
      if (event.key === 'Escape') { setMenu(null); setDropActive(false); dragDepth.current = 0; }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);
  const resizePanel = (side: 'left' | 'right', event: ReactPointerEvent) => {
    const element = event.currentTarget as HTMLElement; element.setPointerCapture(event.pointerId);
    const start = event.clientX, width = side === 'left' ? leftWidth : rightWidth;
    const move = (moveEvent: PointerEvent) => { const next = Math.max(230, Math.min(460, width + (moveEvent.clientX - start) * (side === 'left' ? 1 : -1))); side === 'left' ? setLeftWidth(next) : setRightWidth(next); };
    const end = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end); };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end);
  };
  const changeVisibility = (id: string, visible: boolean) => { viewer.current?.setVisibility(id, visible); if (model) updateModel({ ...model, meshes: model.meshes.map(mesh => mesh.id === id ? { ...mesh, visible } : mesh) }); };
  const isolate = (id: string) => { viewer.current?.isolate(id); if (model) updateModel({ ...model, meshes: model.meshes.map(mesh => ({ ...mesh, visible: mesh.id === id })) }); };
  const showAll = () => { viewer.current?.showAll(); if (model) updateModel({ ...model, meshes: model.meshes.map(mesh => ({ ...mesh, visible: true })) }); };
  const addLight = (type: 'point' | 'directional') => {
    setMenu(null); const position = viewer.current?.suggestedLightPosition() || [2, 3, 2] as [number, number, number];
    const settings: LightSettings = { id: crypto.randomUUID(), name: `${type === 'point' ? 'Point' : 'Directional'} ${++lightCount.current[type]}`, type, enabled: true, color: '#fff0dd', intensity: type === 'point' ? Math.max(1, position.reduce((s, v) => s + v * v, 0) * 8) : 2, position, rotation: [-35, 35, 0], range: 0 };
    viewer.current?.addLight(settings); setLights(previous => [...previous, settings]); setLightTool(type === 'point' ? 'translate' : 'rotate'); viewer.current?.setLightTool(type === 'point' ? 'translate' : 'rotate'); selectLight(settings.id);
  };
  const editLight = (light: LightSettings) => { setLights(previous => previous.map(item => item.id === light.id ? light : item)); viewer.current?.updateLight(light); };
  const removeLight = (id: string) => { viewer.current?.removeLight(id); setLights(previous => previous.filter(light => light.id !== id)); if (selectedLight === id) { setSelectedLight(null); setTarget('environment'); } };
  const changeEnvironment = (value: typeof environment) => { setEnvironment(value); viewer.current?.setEnvironment(value.rotation, value.intensity, value.exposure); };
  const resetLighting = () => { lights.forEach(light => viewer.current?.removeLight(light.id)); setLights([]); setSelectedLight(null); viewer.current?.resetStudio(); changeEnvironment({ rotation: 0, intensity: 1, exposure: 1 }); setTarget('environment'); };
  const refreshMaterials = () => { const current = modelRef.current; if (current && viewer.current) updateModel({ ...current, materials: viewer.current.refreshMaterials() }); };
  const resolveTexture = async (reference: TextureReference, resource: Resource) => { const current = modelRef.current; await loadTextureReference(reference, resource); if (modelRef.current?.path === current?.path) refreshMaterials(); };
  const locateTextures = async () => {
    setLocating(true);
    try {
      const files = await window.desktop.textureFolder(); if (!files) return;
      additionalTextures.current = [...additionalTextures.current, ...files.filter(file => !additionalTextures.current.some(item => item.path === file.path))];
      const current = modelRef.current;
      const unresolved = viewer.current?.getTextureReferences().filter(ref => ref.status !== 'loaded') || [];
      await Promise.all(unresolved.map(async ref => { ref.candidates = candidatesFor(ref.reference, files); if (ref.candidates.length === 1) await loadTextureReference(ref, ref.candidates[0]); else ref.status = ref.candidates.length ? 'ambiguous' : 'missing'; }));
      if (modelRef.current?.path === current?.path) { refreshMaterials(); setNotice(`${unresolved.filter(ref => ref.status === 'loaded').length} textures resolved. ${unresolved.filter(ref => ref.status !== 'loaded').length} unresolved.`); }
    } catch (error) { setError(messageOf(error)); } finally { setLocating(false); }
  };
  const chooseBackgroundImage = async () => { try { const image = await window.desktop.background(); if (image) setBackground(previous => ({ ...previous, type: 'image', image })); } catch (error) { setError(messageOf(error)); } };
  const backgroundStyle: CSSProperties = { backgroundColor: background.color, backgroundImage: background.type === 'gradient' ? `linear-gradient(180deg, ${background.color}, ${background.bottom})` : background.type === 'image' && background.image ? `url("${background.image.url}")` : undefined, backgroundSize: background.fit === 'fill' ? 'cover' : 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };

  return <div className="app" onDragEnter={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDropActive(true); } }} onDragLeave={event => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDropActive(false); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={async event => { event.preventDefault(); dragDepth.current = 0; setDropActive(false); try { const targets = await window.desktop.drop(Array.from(event.dataTransfer.files)); const folder = targets.find(target => target.kind === 'folder'); if (folder) handleTarget(folder); const file = targets.filter(target => target.kind === 'file').at(-1); if (file) handleTarget(file); } catch (error) { setError(messageOf(error)); } }}>
    <header className="titlebar"><div className="app-mark"><Box size={20} strokeWidth={1.5} /></div><strong>FBX Viewer</strong><div className="title-divider" /><div className="menu-anchor"><button className="file-menu-button" onClick={() => setMenu(menu === 'file' ? null : 'file')}>File<ChevronDown size={11} /></button>{menu === 'file' && <><button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenu(null)} /><div className="dropdown file-dropdown"><button onClick={openFile}><FileBox size={14} />Open File…<kbd>Ctrl O</kbd></button><button onClick={openFolder}><FolderOpen size={14} />Open Folder…<kbd>Ctrl Shift O</kbd></button></div></>}</div><span className="title-document">{model?.name || 'No asset open'}</span><span className="title-version">1.0</span></header>
    <div className="workspace-bar"><div className="open-actions"><button className="primary" onClick={openFile}><FileBox size={15} />Open File</button><button className="secondary" onClick={openFolder}><FolderOpen size={15} />Open Folder</button></div><div className="workspace-breadcrumb"><span>Workspace</span><ChevronRight size={12} /><span title={root}>{root ? root.split(/[\\/]/).pop() : 'Local assets'}</span>{model && <><ChevronRight size={12} /><strong>{model.name}</strong></>}</div><div className="layout-actions"><IconButton icon={PanelLeft} label="Toggle Asset Browser" active={leftOpen} onClick={() => setLeftOpen(!leftOpen)} /><IconButton icon={PanelRight} label="Toggle inspector" active={rightOpen} onClick={() => setRightOpen(!rightOpen)} /></div></div>
    <main className="workspace" style={{ gridTemplateColumns: `${leftOpen ? `${leftWidth}px 5px` : '0px 0px'} minmax(300px, 1fr) ${rightOpen ? `5px ${rightWidth}px` : '0px 0px'}` }}>
      <div className={`left-panel ${!leftOpen ? 'collapsed' : ''}`}><AssetBrowser root={root} assets={assets} selected={selectedAsset} preview={model?.path} scanning={scanning} warnings={scanWarnings} onSelect={openAsset} onFolder={openFolder} onRefresh={() => startScan(root, true)} onCollapse={() => setLeftOpen(false)} /></div>
      <div className={`resize-handle ${!leftOpen ? 'collapsed' : ''}`} role="separator" aria-label="Resize Asset Browser" aria-orientation="vertical" tabIndex={0} onPointerDown={event => resizePanel('left', event)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setLeftWidth(width => Math.max(230, Math.min(460, width + (event.key === 'ArrowRight' ? 16 : -16)))); }} />
      <section className="center-panel"><div className="viewport-toolbar"><div className="segmented view-modes">{(['solid', 'wireframe', 'rendered', 'map'] as ViewMode[]).map(value => <button key={value} className={mode === value ? 'active' : ''} onClick={() => chooseMode(value)}>{value === 'map' ? 'Map' : value[0].toUpperCase() + value.slice(1)}</button>)}</div><div className="toolbar-divider" /><IconButton icon={Layers3} label="Wireframe overlay" active={wireOverlay} disabled={mode === 'wireframe' || mode === 'map'} onClick={() => { setWireOverlay(!wireOverlay); viewer.current?.setMode(mode, !wireOverlay); }} /><div className="spacer" /><div className="menu-anchor"><button className="toolbar-button" onClick={() => setMenu(menu === 'light' ? null : 'light')}><Plus size={14} /><span>Add Light</span><ChevronDown size={10} /></button>{menu === 'light' && <><button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenu(null)} /><div className="dropdown light-dropdown"><button onClick={() => addLight('point')}><Lightbulb size={14} />Point Light</button><button onClick={() => addLight('directional')}><Sun size={14} />Directional Light</button></div></>}</div><button className={`toolbar-button ${target === 'environment' && rightOpen ? 'active' : ''}`} onClick={() => setInspectorTarget('environment')}><Image size={14} /><span>Background</span></button></div>
        <div className="viewport" style={backgroundStyle}><div ref={host} className="viewport-canvas" /><div className="viewport-top"><div className="viewport-label"><span className="status-dot" />{mode === 'map' ? 'Texture inspection' : 'Perspective'}<span className="viewport-label-divider" />{mode === 'rendered' ? 'Studio' : mode === 'solid' ? 'Solid' : mode === 'wireframe' ? 'Wireframe' : channel}</div><select className="camera-picker" aria-label="Camera view" defaultValue="perspective" onChange={event => viewer.current?.cameraView(event.target.value as 'perspective' | 'front' | 'side' | 'top')}><option value="perspective">Perspective</option><option value="front">Front</option><option value="side">Right</option><option value="top">Top</option></select></div>
          {!model && !busy && <div className="viewport-empty"><div className="empty-cube"><Box size={58} strokeWidth={0.85} /></div><h1>No model open</h1><p>Drop an FBX or folder here</p><button className="secondary" onClick={openFile}>Open File</button></div>}
          {busy && <div className="loading-indicator" role="status"><span className="spinner" /><span>Loading {busy}</span></div>}
          {(error || notice) && <div className={`viewport-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><IconButton icon={X} label="Dismiss message" onClick={() => { setError(''); setNotice(''); }} /></div>}
          <div className="viewport-bottom"><span className="navigation-hint">Drag to orbit <span>·</span> Middle-drag to pan <span>·</span> Scroll to zoom</span><div className="viewport-tools"><IconButton icon={Grid2X2} label="Show grid" active={grid} onClick={() => { setGrid(!grid); viewer.current?.setGrid(!grid); }} /><IconButton icon={Axis3D} label="Show axes" active={axes} onClick={() => { setAxes(!axes); viewer.current?.setAxes(!axes); }} />{model?.hasSkeleton && <IconButton icon={Bone} label="Show skeleton" active={skeleton} onClick={() => { setSkeleton(!skeleton); viewer.current?.setSkeleton(!skeleton); }} />}<span className="toolbar-divider" /><IconButton icon={Crosshair} label="Frame selection (F)" disabled={!model} onClick={() => viewer.current?.frame()} /><IconButton icon={Maximize} label="Frame all" disabled={!model} onClick={() => viewer.current?.frame(false)} /></div></div>
        </div>
        {model && model.clips.length > 0 && <Timeline model={model} playback={playback} viewer={viewer.current} skeleton={skeleton} onSkeleton={value => { setSkeleton(value); viewer.current?.setSkeleton(value); }} />}
        <div className="viewport-stats"><span><Box size={12} />{model ? `${model.meshes.length} meshes` : 'No geometry'}</span><span>{model?.triangles.toLocaleString() || '0'} triangles</span><span>{model?.materials.length || 0} materials</span><div className="spacer" /><span className="dimensions">{model ? `${model.dimensions.map(value => value.toFixed(2)).join(' × ')} ${model.unit}` : 'FBX importer'}</span></div>
      </section>
      <div className={`resize-handle ${!rightOpen ? 'collapsed' : ''}`} role="separator" aria-label="Resize inspector" aria-orientation="vertical" tabIndex={0} onPointerDown={event => resizePanel('right', event)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setRightWidth(width => Math.max(230, Math.min(460, width + (event.key === 'ArrowLeft' ? 16 : -16)))); }} />
      <div className={`right-panel ${!rightOpen ? 'collapsed' : ''}`}><Inspector target={target} onTarget={setInspectorTarget} onCollapse={() => setRightOpen(false)} model={model} selectedMesh={selectedMesh} selectedMaterial={selectedMaterial} onMesh={selectMesh} onMaterial={id => { setSelectedMaterial(id); setMap(null); setInspectorTarget('material'); }} onVisibility={changeVisibility} onIsolate={isolate} onShowAll={showAll} onFrame={() => viewer.current?.frame()} map={map} channel={channel} onMap={(input, channel) => { setMap(input); setChannel(channel); setMode('map'); if (selectedMaterial) viewer.current?.setMap(selectedMaterial, input, channel); }} onVertexColors={(id, enabled) => { const materials = viewer.current?.setVertexColors(id, enabled); if (model && materials) updateModel({ ...model, materials }); }} onLocate={locateTextures} locating={locating} onResolve={resolveTexture} lights={lights} selectedLight={selectedLight} onLight={selectLight} onAddLight={addLight} onEditLight={editLight} onRemoveLight={removeLight} lightTool={lightTool} onLightTool={tool => { setLightTool(tool); viewer.current?.setLightTool(tool); }} helpers={helpers} onHelpers={value => { setHelpers(value); viewer.current?.setHelpers(value); }} background={background} onBackground={setBackground} onBackgroundImage={chooseBackgroundImage} onResetBackground={() => setBackground(DEFAULT_BACKGROUND)} environment={environment} onEnvironment={changeEnvironment} onResetLighting={resetLighting} /></div>
    </main>
    <footer className="app-status"><span className={`status-dot ${busy ? 'busy' : ''}`} /><span>{busy ? 'Importing model' : scanning ? 'Scanning assets' : ready ? 'Ready' : 'Starting viewport'}</span><span className="spacer" /><span>Local files</span><span className="footer-divider" /><span>FBX Viewer</span></footer>
    {dropActive && <div className="drop-overlay"><FolderOpen size={42} strokeWidth={1.2} /><strong>Drop an FBX or folder</strong></div>}
  </div>;
}
