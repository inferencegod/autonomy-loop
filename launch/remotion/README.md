# autonomy-loop — launch clip (Remotion)

A ~26s, 1080p launch video for X. Six scenes: title → builder/reviewer baton → 5-lens reviewer →
gate-guard DENY → no-fabrication → CTA.

## Render it
```bash
cd launch/remotion
npm install
npm run studio        # live preview/editing at localhost:3000
npm run render        # -> out/autonomy-loop.mp4   (best for X)
npm run render:gif    # -> out/autonomy-loop.gif   (heavier; mp4 preferred on X)
```
Requires Node 18+. Remotion downloads a headless Chromium on first render.

## Before posting
- Replace `inferencegod` in `src/Clip.tsx` (CTA scene) with your GitHub handle.
- Tune colors at the top of `src/Clip.tsx` (BUILD green / REVIEW amber / DENY red).
- For square (X feed) export 1080×1080: change `width`/`height` in `src/Root.tsx` and re-center.
