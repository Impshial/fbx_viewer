# FBX Viewer

A Windows-first desktop inspector for local FBX assets, built with Electron, React, TypeScript, Vite, and Three.js. Model and texture files are read-only. The packaged application runs offline.

## Development

Use Node.js 22.12+ (or a newer supported LTS release).

```sh
npm install
npm run dev
```

The repository also includes a pnpm lockfile. With pnpm installed, use `pnpm install` and `pnpm dev`. On pnpm versions that require build approval, approve the Electron and esbuild install scripts.

```sh
npm run typecheck
npm run build
npm start
```

## Windows packaging

Run on Windows:

```sh
npm run package:win
```

This produces a portable executable and an NSIS installer in `release/`. For an unpacked application directory, run `npm run package:dir`, then open `release/win-unpacked/FBX Viewer.exe`.

Builds are unsigned. No certificate or publishing service is required for local development. The first install/build needs internet access to download dependencies and packaging tools; the resulting application does not.

## Controls

| Action | Control |
| --- | --- |
| Open model | Open File, File menu, or Ctrl+O |
| Open asset folder | Open Folder, File menu, or Ctrl+Shift+O |
| Drop files | Drop a local FBX or folder onto the window |
| Orbit | Left-drag |
| Pan | Middle-drag or right-drag |
| Zoom | Mouse wheel |
| Frame | F, Frame selection, or Frame all |
| Select material slot | Click a mesh surface |
| Set orbit center | Double-click a surface |
| Browse filtered FBXs | Up/Down while the asset list has focus |
| Play/pause | Animation controls, or Space with the viewport focused |

Both side panels resize by dragging their inner border. Their toolbar buttons collapse and restore them. The Scene tab lists mesh visibility and material slots. Select a mesh to isolate it; Show all restores visibility.

## Materials and textures

- Rendered uses the imported material with live studio and custom lights. Solid uses neutral shading. Wireframe and the wire overlay follow skeletal and object animation. Changing view modes preserves camera and playback state.
- Click a loaded material input for unlit Map view and its thumbnail. RGB/R/G/B/A buttons inspect individual channels using the original UVs. Known channel labels describe the renderer's material input; unknown packing is not inferred.
- The importer resolves embedded images, references beneath the FBX directory (including `.fbm` folders), and textures beneath the currently opened asset folder. An explicitly located texture folder is also reused for subsequent assets during the session.
- Missing references display their expected names. **Locate Texture Folder** retries unresolved references together. Duplicate matches require a choice in the material inspector.
- When a base-color texture is assigned, **Vertex colors** defaults to off so shader-mask colors do not tint the texture. Materials without a base-color texture retain imported vertex colors. Use the material inspector toggle to override this per material; the choice survives view changes and texture recovery for the current asset. This changes only the viewer.
- PNG, JPEG, WebP, BMP, GIF, TGA, and supported DDS textures can be loaded. TIFF references are identified but not decoded.

## Animation, lights, and background

Embedded clips populate the clip picker. Playback supports loop, speed, restart, and paused scrubbing. Animation-only FBXs show their skeleton; this version does not retarget or attach a separate animation file to another model.

Add multiple point or directional lights and select them in the inspector or by clicking a viewport handle. Point lights have position and range. Directional lights have separate **Move** and **Aim** gizmos; moving a handle preserves its direction. Intensity and color update immediately. Lights persist across model changes. **Reset Studio Lighting** restores the studio and removes custom lights.

The studio uses a procedurally generated, bundled environment with hemisphere and directional illumination. Rotation, strength, and exposure are editable. Background supports solid colors, vertical gradients, and local PNG/JPEG images with Fit/Fill. It is composited behind the WebGL canvas and does not affect lighting, reflections, or exposure. Background and custom lights persist while browsing, but are not saved across application restarts.

## Import boundaries

FBX is the working importer. Recognized extensions and active importers are separate registries in `src/shared.ts`. Other 3D formats are listed as **Preview unavailable** and leave the current model intact.

[Three.js FBXLoader](https://threejs.org/docs/pages/FBXLoader.html) supports binary FBX 6400+ and ASCII FBX 7.0+. Legacy Phong/Lambert materials are preserved; engine-specific material graphs and unsupported FBX properties are not reconstructed. Roughness/metallic inputs are shown when available, but the FBX loader does not translate arbitrary PBR shaders. Import notices are available in Asset information. Morph/blend-shape normal animation is an upstream limitation. Large imports parse in a dedicated worker; final geometry upload still uses the renderer thread. Files over 1 GB are rejected. Symlinked folders are skipped during recursive scanning.

File units are converted to meters when FBX unit metadata is available. Otherwise dimensions are labeled as file units. Source up-axis metadata is applied to the viewer wrapper without changing bone or object transforms.

## Implementation

- `electron/main.ts`: native dialogs, native File menu, cancellable folder scans, authorized read-only resource protocol.
- `electron/preload.ts`: narrow context-isolated IPC bridge; Node integration is disabled in the renderer.
- `src/viewer/fbx.worker.ts`: background FBX parse and hierarchy/skeleton/clip serialization.
- `src/viewer/importer.ts`: texture resolution, recovery, metadata, and source resource ownership.
- `src/viewer/Viewer.ts`: Three.js scene, camera, animation, selection, display materials, and light gizmos.
- `src/components/`: asset browser, inspector, timeline, and shared controls.

Build and smoke-check results are recorded in [DEVELOPMENT.md](DEVELOPMENT.md). User-provided assets are not included in this repository.
