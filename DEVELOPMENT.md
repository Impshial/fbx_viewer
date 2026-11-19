# Development verification

Verification was intentionally limited to build checks and focused smoke checks for this development version.

## Run on Windows

- TypeScript type-check: passed.
- Vite production build and bundled Electron main/preload build: passed.
- Desktop launch using the production renderer: passed.
- Windows NSIS installer and portable executable: built successfully; unsigned.
- Packaged `win-unpacked/FBX Viewer.exe`: launched as packaged version 1.0.0, opened the archery FBX, and reported no application error.
- Opened the user-provided `SM_Archery.fbx` independently of a folder: 1 mesh, 1,554 triangles, 1 material; unit conversion reported meters.
- Scanned the user-provided Toony Tiny RTS asset folder: 588 recognized FBX files.
- Switched Solid/Rendered modes with a wire overlay.
- Added a point light and selected a black background; both persisted when switching assets.
- Opened `Anim_banner_idle_A.fbx`: one embedded clip, skeleton-only preview, and paused scrubbing to 0.50 seconds.
- Recovered the archery model's missing external base-color texture from the shared Textures folder.
- Visually checked textured rendering, framing, the map thumbnail, and alpha-channel inspection.

The focused checks caught and corrected overly tight framing and thumbnail/texture replacement bugs. The test files and screenshots remain local and are not committed or packaged.

One initial Electron launch from the restricted automation shell failed during debugger startup with Windows exit code `0xC0000005`. The same application launched successfully outside that restriction. No Windows fault-module record was available to establish a more specific cause. Subsequent focused development launches completed successfully.

## Not exhaustively verified

- Native dialog interaction by a human (smoke checks supplied selections through Electron's dialog API), drag-and-drop, and all mouse/gizmo interactions.
- Duplicate-name texture choice, inaccessible folders, rapid-selection cancellation under load, and very large assets.
- Every skeletal/morph animation variant, clip switching, and wire overlay throughout playback on a skinned character. The supplied animation-only fixture was checked; retargeting separate files is not implemented.
- Every light/background combination, multiple-light editing, all background image aspect ratios, and every texture encoding.
- Cross-machine GPU behavior, installer installation/uninstallation, signing, macOS, and Linux.

The source includes these controls and error paths; these are development verification limits, not a claim of exhaustive test coverage.
