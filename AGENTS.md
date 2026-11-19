# Project instructions

- Use plain, concise, functional interface text. Avoid promotional copy, slogans, decorative prose, motivational language, and anthropomorphic messages.
- Keep models and textures read-only. Inspection changes belong to the viewer.
- Preserve imported hierarchy, skinning, material data, animation time, and camera when changing display settings.
- Keep recognized extensions separate from working importers in `src/shared.ts`.
- Use focused development checks: type-check, build, and a small smoke check appropriate to the change. Do not add broad production-level testing unless requested.
- Do not commit user-provided asset files, local smoke-check output, or packaged binaries.

Useful commands: `npm run dev`, `npm run typecheck`, `npm run build`, and `npm run package:win`.
