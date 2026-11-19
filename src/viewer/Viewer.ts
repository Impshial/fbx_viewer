import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ImportedModel } from './importer';
import { cloneDisplayTexture, describeMaterials } from './importer';
import type { Channel, InputKey, LightSettings, ModelInfo, Playback, ViewerEvents, ViewMode } from './types';

interface LightEntry { settings: LightSettings; light: THREE.PointLight | THREE.DirectionalLight; handle: THREE.Group; icon: THREE.Mesh; arrow?: THREE.ArrowHelper; }
export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly transform: TransformControls;
  private resize: ResizeObserver;
  private frameId = 0;
  private lastTime = performance.now();
  private lastEmit = 0;
  private model: ImportedModel | null = null;
  private meshes: THREE.Mesh[] = [];
  private originals = new Map<string, THREE.Material | THREE.Material[]>();
  private displayMaterials: THREE.Material[] = [];
  private displayTextures: THREE.Texture[] = [];
  private overlays = new Map<string, THREE.Mesh>();
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private skeleton: THREE.SkeletonHelper | null = null;
  private selected: THREE.Mesh | null = null;
  private selection = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#66d9c1'));
  private grid = new THREE.GridHelper(20, 20, '#57606b', '#424a55');
  private axes = new THREE.AxesHelper(1);
  private studio = new THREE.Group();
  private environment: THREE.WebGLRenderTarget;
  private lights = new Map<string, LightEntry>();
  private helpersVisible = true;
  private selectedLight: string | null = null;
  private lightTool: 'translate' | 'rotate' = 'translate';
  private pointerDown = { x: 0, y: 0, moved: false, transform: false };
  private mode: ViewMode = 'rendered';
  private overlayEnabled = false;
  private mapSelection: { material: string; input: InputKey; channel: Channel } | null = null;
  private radius = 1;
  private disabledVertexColors = new Set<string>();
  playback: Playback = { clip: 0, playing: false, loop: true, speed: 1, time: 0, duration: 0 };

  constructor(private host: HTMLElement, private events: ViewerEvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.setAttribute('aria-label', '3D viewport');
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.camera.position.set(3, 2, 4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.8);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', event => { this.controls.enabled = !event.value; if (event.value) this.pointerDown.transform = true; });
    this.transform.addEventListener('objectChange', () => {
      const entry = this.selectedLight ? this.lights.get(this.selectedLight) : undefined;
      if (!entry) return;
      entry.settings = { ...entry.settings, position: entry.handle.position.toArray() as [number, number, number], rotation: [entry.handle.rotation.x, entry.handle.rotation.y, entry.handle.rotation.z].map(THREE.MathUtils.radToDeg) as [number, number, number] };
      this.syncLight(entry); this.events.lightChange({ ...entry.settings });
    });
    this.selection.visible = false; (this.selection.material as THREE.Material).depthTest = false; this.selection.renderOrder = 5;
    this.scene.add(this.grid, this.axes, this.selection, this.studio);
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04); room.dispose(); pmrem.dispose();
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.65;
    this.resetStudio();
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('dblclick', this.onDoubleClick);
    this.resize = new ResizeObserver(() => this.onResize()); this.resize.observe(host);
    this.onResize(); this.tick();
  }
  private onResize() { const { width, height } = this.host.getBoundingClientRect(); if (!width || !height) return; this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }
  private onPointerDown = (event: PointerEvent) => { this.pointerDown = { x: event.clientX, y: event.clientY, moved: false, transform: this.transform.dragging || !!this.transform.axis }; };
  private onPointerMove = (event: PointerEvent) => { if (Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 5) this.pointerDown.moved = true; };
  private ray(event: MouseEvent) { const rect = this.renderer.domElement.getBoundingClientRect(); const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera); return ray; }
  private onPointerUp = (event: PointerEvent) => {
    if (event.button !== 0 || this.pointerDown.moved || this.pointerDown.transform || this.transform.dragging) return;
    const ray = this.ray(event);
    if (this.helpersVisible) {
      const hit = ray.intersectObjects([...this.lights.values()].map(entry => entry.icon), false)[0];
      if (hit) { this.events.lightSelect(hit.object.userData.lightId); return; }
    }
    const hit = ray.intersectObjects(this.meshes.filter(mesh => mesh.visible), false)[0];
    if (!hit) { this.selectMesh(null); this.events.select(null, null); return; }
    const mesh = hit.object as THREE.Mesh;
    const originals = this.originals.get(mesh.uuid)!;
    const material = Array.isArray(originals) ? originals[hit.face?.materialIndex ?? 0] : originals;
    this.selectMesh(mesh.uuid); this.events.select(mesh.uuid, material?.uuid ?? null);
  };
  private onDoubleClick = (event: MouseEvent) => { if (this.transform.dragging || this.transform.axis) return; const hit = this.ray(event).intersectObjects(this.meshes.filter(mesh => mesh.visible), false)[0]; if (hit) { this.controls.target.copy(hit.point); this.controls.update(); } };
  private tick = () => {
    this.frameId = requestAnimationFrame(this.tick);
    const now = performance.now(), delta = Math.min((now - this.lastTime) / 1000, 0.1); this.lastTime = now;
    if (this.mixer && this.action && this.playback.playing) {
      this.mixer.update(delta * this.playback.speed); this.playback.time = this.action.time;
      if (now - this.lastEmit > 60) { this.events.playback({ ...this.playback }); this.lastEmit = now; }
    }
    this.model?.root.updateMatrixWorld(true);
    for (const mesh of this.meshes) {
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).computeBoundingSphere();
      const overlay = this.overlays.get(mesh.uuid);
      if (overlay && mesh.morphTargetInfluences) overlay.morphTargetInfluences = mesh.morphTargetInfluences;
    }
    if (this.selected?.visible) { if ((this.selected as THREE.SkinnedMesh).isSkinnedMesh) (this.selected as THREE.SkinnedMesh).computeBoundingBox(); this.selection.box.setFromObject(this.selected); }
    this.skeleton?.updateMatrixWorld(true);
    this.controls.update();
    // Constant screen-size light handles, independent of model scale.
    for (const entry of this.lights.values()) { const scale = this.camera.position.distanceTo(entry.handle.position) * 0.018; entry.icon.scale.setScalar(scale); if (entry.arrow) entry.arrow.setLength(scale * 8, scale * 1.8, scale); }
    this.renderer.render(this.scene, this.camera);
  };
  setModel(model: ImportedModel): ModelInfo {
    const previous = this.model;
    this.transform.detach(); this.selectedLight = null; this.selected = null; this.selection.visible = false;
    this.clearDisplay();
    if (previous) this.scene.remove(previous.root);
    if (this.skeleton) { this.scene.remove(this.skeleton); this.skeleton.dispose(); this.skeleton = null; }
    this.mixer?.stopAllAction(); if (previous) this.mixer?.uncacheRoot(previous.root);
    this.model = model; this.meshes = []; this.originals.clear(); this.disabledVertexColors.clear();
    model.root.traverse(node => {
      if ((node as THREE.Light).isLight || (node as THREE.Camera).isCamera) node.visible = false;
      if ((node as THREE.Mesh).isMesh) { const mesh = node as THREE.Mesh; this.meshes.push(mesh); this.originals.set(mesh.uuid, mesh.material); }
    });
    this.scene.add(model.root); model.root.updateMatrixWorld(true);
    let hasSkeleton = false; model.root.traverse(node => { if ((node as THREE.Bone).isBone) hasSkeleton = true; });
    if (hasSkeleton) { this.skeleton = new THREE.SkeletonHelper(model.root); this.skeleton.visible = this.meshes.length === 0; (this.skeleton.material as THREE.Material).depthTest = false; this.skeleton.renderOrder = 4; this.scene.add(this.skeleton); }
    const bounds = this.boundsOf(model.root), dimensions = bounds.getSize(new THREE.Vector3());
    this.radius = Math.max(dimensions.length() / 2, 0.001);
    this.grid.scale.setScalar(this.radius / 5); this.grid.position.y = bounds.isEmpty() ? 0 : bounds.min.y - this.radius * 0.001;
    this.axes.scale.setScalar(this.radius * 0.3); this.axes.position.copy(this.grid.position);
    this.mixer = new THREE.AnimationMixer(model.root);
    this.mixer.addEventListener('finished', () => { this.playback.playing = false; this.playback.time = this.playback.duration; this.events.playback({ ...this.playback }); });
    this.action = null; this.playback = { ...this.playback, clip: 0, playing: false, time: 0, duration: 0 };
    if (model.root.animations.length) this.setClip(0); else this.events.playback({ ...this.playback });
    this.mapSelection = null; if (this.mode === 'map') this.mode = 'rendered';
    this.applyMode(); this.frame(); previous?.dispose();
    return { name: model.source.name, path: model.source.path, meshes: this.meshes.map(mesh => {
      const material = this.originals.get(mesh.uuid)!;
      return { id: mesh.uuid, name: mesh.name || 'Unnamed mesh', triangles: this.triangles(mesh), materials: (Array.isArray(material) ? material : [material]).map(m => m.uuid), visible: true };
    }), materials: model.materials, clips: model.root.animations.map((clip, i) => ({ name: clip.name || `Clip ${i + 1}`, duration: clip.duration })), triangles: this.meshes.reduce((sum, mesh) => sum + this.triangles(mesh), 0), dimensions: dimensions.toArray() as [number, number, number], unit: model.unit, hasSkeleton, warnings: model.warnings };
  }
  private triangles(mesh: THREE.Mesh) { return Math.floor((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3); }
  private boundsOf(target: THREE.Object3D) { const box = new THREE.Box3().setFromObject(target); if (box.isEmpty()) target.traverse(node => { if ((node as THREE.Bone).isBone) box.expandByPoint(node.getWorldPosition(new THREE.Vector3())); }); return box; }
  frame(selection = true) {
    if (!this.model) return;
    const target = selection && this.selected ? this.selected : this.model.root;
    target.updateWorldMatrix(true, true);
    this.meshes.forEach(mesh => { if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).computeBoundingBox(); });
    const box = this.boundsOf(target); if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const limitingHalfFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * this.camera.aspect));
    const distance = size.length() / (2 * Math.sin(limitingHalfFov)) * 1.12;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize(); if (!direction.lengthSq()) direction.set(1, 0.6, 1).normalize();
    this.controls.target.copy(center); this.camera.position.copy(center).addScaledVector(direction, Math.max(distance, 0.01));
    this.camera.near = Math.max(this.radius / 1000, 0.00001); this.camera.far = Math.max(this.radius * 1000, 100);
    this.camera.updateProjectionMatrix(); this.controls.minDistance = this.radius / 100; this.controls.maxDistance = this.radius * 100;
    this.controls.update();
  }
  cameraView(view: 'perspective' | 'front' | 'side' | 'top') { const distance = this.camera.position.distanceTo(this.controls.target); const vector = view === 'front' ? new THREE.Vector3(0, 0, 1) : view === 'side' ? new THREE.Vector3(1, 0, 0) : view === 'top' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(1, 0.65, 1).normalize(); this.camera.position.copy(this.controls.target).addScaledVector(vector, distance); this.controls.update(); }
  selectMesh(id: string | null) { this.selectLight(null); this.selected = this.meshes.find(mesh => mesh.uuid === id) ?? null; this.selection.visible = !!this.selected?.visible; }
  setVisibility(id: string, visible: boolean) { const mesh = this.meshes.find(mesh => mesh.uuid === id); if (mesh) mesh.visible = visible; this.selection.visible = !!this.selected?.visible; }
  isolate(id: string) { this.meshes.forEach(mesh => { mesh.visible = mesh.uuid === id; }); }
  showAll() { this.meshes.forEach(mesh => { mesh.visible = true; }); }
  setGrid(visible: boolean) { this.grid.visible = visible; }
  setAxes(visible: boolean) { this.axes.visible = visible; }
  setSkeleton(visible: boolean) { if (this.skeleton) this.skeleton.visible = visible; }
  setMode(mode: ViewMode, overlay = this.overlayEnabled) { this.mode = mode; this.overlayEnabled = overlay; this.applyMode(); }
  setMap(material: string, input: InputKey, channel: Channel) { this.mapSelection = { material, input, channel }; this.mode = 'map'; this.applyMode(); }
  private clearDisplay() { for (const mesh of this.meshes) { const original = this.originals.get(mesh.uuid); if (original) mesh.material = original; const overlay = this.overlays.get(mesh.uuid); if (overlay) mesh.remove(overlay); } this.overlays.clear(); this.displayMaterials.forEach(material => material.dispose()); this.displayTextures.forEach(texture => texture.dispose()); this.displayMaterials = []; this.displayTextures = []; }
  private applyMode() {
    this.clearDisplay();
    const selectedMaterial = this.model?.materials.find(material => material.id === this.mapSelection?.material);
    const input = selectedMaterial?.inputs.find(input => input.key === this.mapSelection?.input);
    for (const mesh of this.meshes) {
      const original = this.originals.get(mesh.uuid)!;
      const materials = Array.isArray(original) ? original : [original];
      const displayed = materials.map(material => {
        let display: THREE.Material = material;
        if (this.mode === 'rendered' && this.disabledVertexColors.has(material.uuid)) { display = material.clone(); display.vertexColors = false; }
        if (this.mode === 'solid') display = new THREE.MeshStandardMaterial({ color: '#b7c0ca', roughness: 0.72, side: material.side });
        else if (this.mode === 'wireframe') display = new THREE.MeshBasicMaterial({ color: '#a6c6d0', wireframe: true, side: THREE.DoubleSide });
        else if (this.mode === 'map') {
          let map = input?.texture && input.status === 'loaded' && material.uuid === selectedMaterial?.id ? input.texture : null;
          if (map && this.mapSelection?.channel !== 'RGB') { map = cloneDisplayTexture(map); map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; this.displayTextures.push(map); }
          const basic = new THREE.MeshBasicMaterial({ color: map ? '#ffffff' : '#525a65', map, side: material.side, toneMapped: false });
          if (map) {
            const channel = this.mapSelection?.channel || 'RGB';
            basic.onBeforeCompile = shader => {
              if (channel === 'RGB') return;
              const component = channel.toLowerCase();
              shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP\nvec4 sampledDiffuseColor = texture2D(map, vMapUv);\ndiffuseColor *= vec4(vec3(sampledDiffuseColor.${component}), 1.0);\n#endif`).replace('#include <colorspace_fragment>', '');
            };
            basic.customProgramCacheKey = () => `map-${channel}`;
          }
          display = basic;
        }
        if (display !== material) this.displayMaterials.push(display);
        return display;
      });
      mesh.material = Array.isArray(original) ? displayed : displayed[0];
      if (this.overlayEnabled && (this.mode === 'solid' || this.mode === 'rendered')) {
        const material = new THREE.MeshBasicMaterial({ color: '#17222a', wireframe: true, transparent: true, opacity: 0.65, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        this.displayMaterials.push(material);
        let overlay: THREE.Mesh;
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) { const source = mesh as THREE.SkinnedMesh; const skin = new THREE.SkinnedMesh(mesh.geometry, material); skin.bind(source.skeleton, source.bindMatrix); overlay = skin; }
        else overlay = new THREE.Mesh(mesh.geometry, material);
        overlay.frustumCulled = false; overlay.renderOrder = 1; overlay.raycast = () => {}; mesh.add(overlay); this.overlays.set(mesh.uuid, overlay);
      }
    }
  }
  refreshMaterials() { if (!this.model) return []; this.model.materials = describeMaterials(this.model.materials.map(m => m.material), this.model.textures); this.model.materials.forEach(m => { m.material.needsUpdate = true; m.vertexColorsEnabled = m.hasVertexColors && !this.disabledVertexColors.has(m.id); }); this.applyMode(); return this.model.materials; }
  setVertexColors(id: string, enabled: boolean) { enabled ? this.disabledVertexColors.delete(id) : this.disabledVertexColors.add(id); return this.refreshMaterials(); }
  getTextureReferences() { return this.model?.textures ?? []; }
  setClip(index: number) {
    const clip = this.model?.root.animations[index]; if (!clip || !this.mixer) return;
    this.mixer.stopAllAction(); this.action = this.mixer.clipAction(clip); this.action.reset(); this.action.clampWhenFinished = true;
    this.action.setLoop(this.playback.loop ? THREE.LoopRepeat : THREE.LoopOnce, this.playback.loop ? Infinity : 1); this.action.play(); this.mixer.update(0);
    this.playback = { ...this.playback, clip: index, time: 0, duration: clip.duration }; this.events.playback({ ...this.playback });
  }
  play(playing: boolean) { if (!this.action) return; if (playing && this.playback.time >= this.playback.duration) this.seek(0); this.action.paused = false; this.playback.playing = playing; this.events.playback({ ...this.playback }); }
  seek(time: number) { if (!this.action || !this.mixer) return; const requested = THREE.MathUtils.clamp(time, 0, this.playback.duration); this.action.enabled = true; this.action.paused = false; this.action.time = Math.min(requested, Math.max(0, this.playback.duration - 1e-7)); this.mixer.update(0); this.playback.time = requested; this.events.playback({ ...this.playback }); }
  setLoop(loop: boolean) { this.playback.loop = loop; this.action?.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1); this.events.playback({ ...this.playback }); }
  setSpeed(speed: number) { this.playback.speed = speed; this.events.playback({ ...this.playback }); }
  resetStudio() {
    this.studio.clear();
    this.studio.add(new THREE.HemisphereLight('#dce8ff', '#5b5148', 1.6));
    const key = new THREE.DirectionalLight('#fff0e1', 2.6); key.position.set(4, 6, 5);
    const fill = new THREE.DirectionalLight('#b1caff', 1.4); fill.position.set(-5, 3, -3);
    this.studio.add(key, fill, key.target, fill.target); this.studio.rotation.y = 0;
    this.scene.environmentRotation.y = 0;
  }
  setEnvironment(rotation: number, intensity: number, exposure: number) { this.scene.environmentRotation.y = THREE.MathUtils.degToRad(rotation); this.studio.rotation.y = THREE.MathUtils.degToRad(rotation); this.scene.environmentIntensity = intensity * 0.65; this.studio.children.forEach(node => { if ((node as THREE.Light).isLight) { const light = node as THREE.Light; light.intensity = (light instanceof THREE.HemisphereLight ? 1.6 : light.color.getHexString() === 'fff0e1' ? 2.6 : 1.4) * intensity; } }); this.renderer.toneMappingExposure = exposure; }
  addLight(settings: LightSettings) {
    const light = settings.type === 'point' ? new THREE.PointLight() : new THREE.DirectionalLight();
    const handle = new THREE.Group(); const icon = new THREE.Mesh(settings.type === 'point' ? new THREE.OctahedronGeometry(1) : new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshBasicMaterial({ color: '#f1c574', depthTest: false, toneMapped: false }));
    icon.userData.lightId = settings.id; icon.renderOrder = 8; handle.add(icon);
    const entry: LightEntry = { settings: { ...settings }, light, handle, icon };
    if (light instanceof THREE.DirectionalLight) { entry.arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1, '#f1c574'); handle.add(entry.arrow); this.scene.add(light.target); }
    this.lights.set(settings.id, entry); this.scene.add(light, handle); this.syncLight(entry); this.selectLight(settings.id);
  }
  updateLight(settings: LightSettings) { const entry = this.lights.get(settings.id); if (entry) { entry.settings = { ...settings }; this.syncLight(entry); } }
  private syncLight(entry: LightEntry) {
    const s = entry.settings; entry.light.color.set(s.color); entry.light.intensity = s.intensity; entry.light.visible = s.enabled;
    entry.handle.position.fromArray(s.position); entry.handle.rotation.set(...s.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]); entry.handle.visible = this.helpersVisible;
    entry.light.position.copy(entry.handle.position); (entry.icon.material as THREE.MeshBasicMaterial).color.set(s.enabled ? s.color : '#69707b');
    if (entry.light instanceof THREE.PointLight) entry.light.distance = s.range;
    else { const direction = new THREE.Vector3(0, 0, -1).applyEuler(entry.handle.rotation); entry.light.target.position.copy(entry.handle.position).add(direction); entry.light.target.updateMatrixWorld(); }
  }
  selectLight(id: string | null) { this.selectedLight = id; const entry = id ? this.lights.get(id) : undefined; if (entry && this.helpersVisible) { this.transform.attach(entry.handle); this.transform.setMode(entry.settings.type === 'point' ? 'translate' : this.lightTool); this.transform.setSpace(this.lightTool === 'rotate' ? 'local' : 'world'); } else this.transform.detach(); }
  setLightTool(tool: 'translate' | 'rotate') { this.lightTool = tool; this.selectLight(this.selectedLight); }
  removeLight(id: string) { const entry = this.lights.get(id); if (!entry) return; if (this.selectedLight === id) this.selectLight(null); this.scene.remove(entry.light, entry.handle); if (entry.light instanceof THREE.DirectionalLight) this.scene.remove(entry.light.target); entry.icon.geometry.dispose(); (entry.icon.material as THREE.Material).dispose(); entry.arrow?.dispose(); entry.light.dispose(); this.lights.delete(id); }
  setHelpers(visible: boolean) { this.helpersVisible = visible; this.lights.forEach(entry => { entry.handle.visible = visible; }); this.selectLight(this.selectedLight); }
  suggestedLightPosition(): [number, number, number] { return this.controls.target.clone().add(new THREE.Vector3(this.radius, this.radius * 1.3, this.radius)).toArray() as [number, number, number]; }
  dispose() {
    cancelAnimationFrame(this.frameId); this.resize.disconnect(); this.controls.dispose(); this.transform.dispose(); this.clearDisplay(); this.model?.dispose(); this.mixer?.stopAllAction(); this.skeleton?.dispose(); this.environment.dispose();
    [...this.lights.keys()].forEach(id => this.removeLight(id)); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); this.axes.geometry.dispose(); (this.axes.material as THREE.Material).dispose(); this.selection.geometry.dispose(); (this.selection.material as THREE.Material).dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
